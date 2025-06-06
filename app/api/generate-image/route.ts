// app/api/generate-image/route.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

// Ensure your API key is secure, loaded from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Must be set in Vercel

if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set!");
    // In a real app, you'd handle this more gracefully
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY || '');
const IMAGE_GENERATION_MODEL = "gemini-2.0-flash-preview-image-generation";
const MODERATION_MODEL = 'gemini-1.5-flash'; // For text prompt moderation

export async function POST(req: NextRequest) {
    let chatId: number = 0; // Declare and initialize chatId here
    let requestPrompt: string = ''; // Initialize requestPrompt for error logging

    try {
        const { prompt, chatId: chatIdFromBody, userId, sharedSecret } = await req.json();
        chatId = chatIdFromBody; // Assign the value from the request body
        requestPrompt = prompt; // Store the prompt for potential error logging

        // Basic security check: Validate shared secret from App Script
        if (sharedSecret !== process.env.SHARED_SECRET) { // Set in Vercel env
            return NextResponse.json({ error: 'Unauthorized request' }, { status: 401 });
        }

        // --- 1. Text Prompt Moderation (Highly Recommended) ---
        const moderationModel = genAI.getGenerativeModel({ model: MODERATION_MODEL });
        const moderationInstruction = "You are a content safety expert. Analyze the following user prompt for any content that could be harmful, sexually explicit, hateful, or promote violence, illegal activities, or self-harm. Respond ONLY with 'SAFE' if the prompt is acceptable, or 'UNSAFE' followed by a brief reason if it is not. Focus on the user's *intent* to generate an image.";

        const moderationResult = await moderationModel.generateContent([moderationInstruction, prompt]);
        const moderationResponseText = moderationResult.response.text().trim();

        if (moderationResponseText.toUpperCase().startsWith('UNSAFE')) {
            const reason = moderationResponseText.substring(5).trim() || "Content deemed unsafe.";
            // Send direct reply to Telegram
            return NextResponse.json({ status: 'moderated', message: reason, prompt: prompt, moderationFeedback: moderationResult.response.promptFeedback });
        }


        // --- 2. Image Generation ---
        const imageGenModel = genAI.getGenerativeModel({ model: IMAGE_GENERATION_MODEL });

        const imageGenResult = await imageGenModel.generateContent({
            contents: [{
                role: 'user',
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                responseModalities: ["TEXT", "IMAGE"], // Crucial for image output
            },
        });

        const candidates = imageGenResult.response.candidates;
        if (!candidates || candidates.length === 0) {
            return NextResponse.json({
                status: 'error',
                message: 'No image candidates found',
                prompt: prompt,
                geminiResponse: imageGenResult.response // Include full Gemini response for debugging
            }, { status: 500 });
        }

        const imagePart = candidates[0].content.parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
        const textPart = candidates[0].content.parts.find(p => p.text);

        if (imagePart && imagePart.inlineData) {
            const imageData = imagePart.inlineData.data;
            const mimeType = imagePart.inlineData.mimeType;
            let caption = prompt; // Default to the original prompt

            if (textPart) {
                caption = textPart.text; // Use the generated text if available
            }

            // --- 3. Post-Generation Image Moderation (Optional) ---
            // const isImageSafe = await checkImageSafety(imageData, mimeType); // Call your Cloud Vision function here
            // if (!isImageSafe) {
            //    await sendTelegramMessage(chatId, "🚫 The generated image was flagged by our safety system. Please try a different prompt.");
            //    return NextResponse.json({ status: 'image_moderated', prompt: prompt, geminiResponse: imageGenResult.response });
            // }


            // Return the full Gemini response, or selected parts, to App Script
            return NextResponse.json({
                status: 'success',
                message: 'Image sent to Telegram',
                prompt: prompt,
                generatedImage: { // Provide structured info about the image
                    mimeType: mimeType,
                    data: imageData, // The base64 image data
                    caption: caption
                },
                geminiResponse: { // Include full Gemini response (or specific parts)
                    candidates: imageGenResult.response.candidates,
                    promptFeedback: imageGenResult.response.promptFeedback
                }
            });
        } else {
            return NextResponse.json({
                status: 'error',
                message: 'No image part found in Gemini response',
                prompt: prompt,
                geminiResponse: imageGenResult.response // Include full Gemini response for debugging
            }, { status: 500 });
        }

    } catch (error: any) {
        console.error("Backend API Error:", error);
        // Ensure error.response is accessed safely and logged
        console.error("Full error object (if available):", error.response); // This will log the entire error object from the API

        // Attempt to send an error message back to the user via Telegram
        return NextResponse.json({
            status: 'error',
            message: error.message || 'Internal server error',
            prompt: requestPrompt, // Include the original prompt
            details: error.response?.text ? await error.response.text() : JSON.stringify(error) // Try to get text or stringify
        }, { status: 500 });
    }
}
