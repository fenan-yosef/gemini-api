// app/api/generate-image/route.ts
import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary'; // <--- NEW: Import Cloudinary

// --- NEW: Configure Cloudinary at the top ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true, // Use HTTPS for secure URLs
});

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
    let chatId: number = 0;
    let requestPrompt: string = '';

    try {
        const { prompt, chatId: chatIdFromBody, userId, sharedSecret } = await req.json();
        chatId = chatIdFromBody;
        requestPrompt = prompt;

        // Basic security check: Validate shared secret from App Script
        if (sharedSecret !== process.env.SHARED_SECRET) {
            // --- MODIFIED: Send Telegram message on unauthorized access ---
            // await sendTelegramMessage(chatId, '🚫 Unauthorized request.');
            return NextResponse.json({ error: 'Unauthorized request' }, { status: 401 });
        }

        // --- 1. Text Prompt Moderation (Highly Recommended) ---
        const moderationModel = genAI.getGenerativeModel({ model: MODERATION_MODEL });
        const moderationInstruction = "You are a content safety expert. Analyze the following user prompt for any content that could be harmful, sexually explicit, hateful, or promote violence, illegal activities, or self-harm. Respond ONLY with 'SAFE' if the prompt is acceptable, or 'UNSAFE' followed by a brief reason if it is not. Focus on the user's *intent* to generate an image.";

        const moderationResult = await moderationModel.generateContent([moderationInstruction, prompt]);
        const moderationResponseText = moderationResult.response.text().trim();

        if (moderationResponseText.toUpperCase().startsWith('UNSAFE')) {
            const reason = moderationResponseText.substring(5).trim() || "Content deemed unsafe.";
            // --- MODIFIED: Send direct reply to Telegram for unsafe prompts ---
            // await sendTelegramMessage(chatId, `🚫 Your request was flagged by our safety system: ${reason}`);
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
                responseModalities: ["TEXT", "IMAGE"],
            } as any, // Type assertion to bypass TypeScript error
        });

        const candidates = imageGenResult.response.candidates;
        if (!candidates || candidates.length === 0) {
            // --- MODIFIED: Send direct reply to Telegram if no candidates found ---
            // await sendTelegramMessage(chatId, "❌ Failed to generate image: No candidates found.");
            console.error("Gemini Image Gen Error: No candidates found.", imageGenResult.response.promptFeedback);
            return NextResponse.json({
                status: 'error',
                message: 'No image candidates found',
                prompt: prompt,
                geminiResponse: imageGenResult.response
            }, { status: 500 });
        }

        const imagePart = candidates[0].content.parts.find(p => p.inlineData && p.inlineData.mimeType.startsWith('image/'));
        const textPart = candidates[0].content.parts.find(p => p.text);

        if (imagePart && imagePart.inlineData) {
            const imageData = imagePart.inlineData.data; // This is your base64 string
            const mimeType = imagePart.inlineData.mimeType;
            let caption = prompt;

            if (textPart) {
                caption = textPart.text;
            }

            // --- NEW: Upload Image to Cloudinary ---
            let imageUrl: string | null = null;
            try {
                // Cloudinary expects data as "data:image/jpeg;base64,..."
                // or just the base64 string. Sending with the prefix is safer.
                const base64ImageWithPrefix = `data:${mimeType};base64,${imageData}`;
                const uploadResult = await cloudinary.uploader.upload(base64ImageWithPrefix, {
                    folder: "gemini-telegram-images", // Optional: organize your uploads in a folder
                    public_id: `gemini-gen-${Date.now()}`, // Optional: provide a unique public ID
                });
                imageUrl = uploadResult.secure_url; // Get the secure HTTPS URL
                console.log("Image uploaded to Cloudinary:", imageUrl);
            } catch (cloudinaryError: any) {
                console.error("Error uploading image to Cloudinary:", cloudinaryError);
                // --- MODIFIED: Send Telegram message on Cloudinary upload failure ---
                // await sendTelegramMessage(chatId, "⚠️ Failed to upload image to cloud storage. Please try again.");
                return NextResponse.json({
                    status: 'error',
                    message: 'Failed to upload image to cloud storage',
                    prompt: prompt,
                    cloudinaryError: cloudinaryError.message,
                }, { status: 500 });
            }

            if (!imageUrl) {
                // await sendTelegramMessage(chatId, "❌ Image URL not available after upload.");
                return NextResponse.json({
                    status: 'error',
                    message: 'Image URL not available',
                    prompt: prompt,
                }, { status: 500 });
            }

            // --- MODIFIED: Send Image URL to Telegram ---
            // Call the updated helper function to send the URL, not the raw data
            // await sendTelegramPhoto(chatId, imageUrl, caption);


            // Return the full Gemini response, plus the Cloudinary URL
            return NextResponse.json({
                status: 'success',
                imageUrl: imageUrl,
                message: caption, // Using the caption here as the primary message
                prompt: prompt,
                generatedImage: { // Provide structured info about the image
                    mimeType: mimeType,
                    // data: imageData, // Still include raw data in response for debugging/logging (optional, can remove)
                    caption: caption,
                    imageUrl: imageUrl, // <--- NEW: Include the Cloudinary URL here!
                },
                geminiResponse: { // Include full Gemini response (or specific parts)
                    candidates: imageGenResult.response.candidates,
                    promptFeedback: imageGenResult.response.promptFeedback
                }
            });
        } else {
            // --- MODIFIED: Send direct reply to Telegram if no image part found ---
            // await sendTelegramMessage(chatId, "❌ No image was found in the model's response. Try a different prompt.");
            return NextResponse.json({
                status: 'error',
                message: 'No image part found in Gemini response',
                prompt: prompt,
                geminiResponse: imageGenResult.response
            }, { status: 500 });
        }

    } catch (error: any) {
        console.error("Backend API Error:", error);
        console.error("Full error object (if available):", error.response);

        // --- MODIFIED: Send direct reply to Telegram on internal bot error ---
        // await sendTelegramMessage(chatId, "⚠️ Internal bot error during image generation. Please try again later.");
        return NextResponse.json({
            status: 'error',
            message: error.message || 'Internal server error',
            prompt: requestPrompt,
            details: error.response?.text ? await error.response.text() : JSON.stringify(error)
        }, { status: 500 });
    }
}

// --- Helper function to send messages to Telegram (no change needed) ---
async function sendTelegramMessage(chatId: number, text: string) {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_BOT_TOKEN) {
        console.error("TELEGRAM_BOT_TOKEN is not set in sendTelegramMessage!");
        return;
    }
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown'
            })
        });
        if (!response.ok) {
            console.error('Telegram sendMessage API Error:', response.status, response.statusText, await response.text());
        }
    } catch (fetchError) {
        console.error('Error fetching Telegram sendMessage:', fetchError);
    }
}

// --- MODIFIED HELPER: sendTelegramPhoto to accept a URL instead of imageData ---
async function sendTelegramPhoto(chatId: number, imageUrl: string, caption: string) {
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (!TELEGRAM_BOT_TOKEN) {
        console.error("TELEGRAM_BOT_TOKEN is not set in sendTelegramPhoto!");
        return;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }, // Telegram expects JSON when sending a URL
            body: JSON.stringify({
                chat_id: chatId,
                photo: imageUrl, // <--- Now sending the URL!
                caption: caption,
                parse_mode: 'Markdown'
            }),
        });

        if (!response.ok) {
            console.error('Telegram sendPhoto API Error:', response.status, response.statusText, await response.text());
        }
    } catch (error) {
        console.error('Error sending photo URL to Telegram:', error);
    }
}