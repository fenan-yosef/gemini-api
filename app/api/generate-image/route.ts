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

        // Moderation removed: relying on provider-side moderation (Stability/Gemini) or local checks.


        // --- 2. Image Generation ---
        // If Stability keys are provided prefer calling Stability's Core endpoint.
        // Support multiple fallback keys via STABILITY_KEYS (comma-separated) or legacy STABILITY_KEY.
        const STABILITY_KEYS_RAW = process.env.STABILITY_KEYS ?? process.env.STABILITY_KEY;
        const STABILITY_KEYS = STABILITY_KEYS_RAW ? STABILITY_KEYS_RAW.split(',').map(k => k.trim()).filter(Boolean) : [];

        async function generateWithStability(promptText: string, apiKey: string) {
            const url = 'https://api.stability.ai/v2beta/stable-image/generate/core';
            const form = new FormData();
            form.append('prompt', promptText);
            // Request JSON so we receive a base64 payload we can decode server-side
            form.append('output_format', 'png');

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: 'application/json'
                },
                body: form as any
            });

            if (!res.ok) {
                // Try to include response body for debugging
                let bodyText: string | object = '';
                try { bodyText = await res.json(); } catch (e) { bodyText = await res.text(); }
                throw new Error(`Stability API error ${res.status}: ${JSON.stringify(bodyText)}`);
            }

            // Expecting JSON response containing base64 image data (field 'image')
            const data = await res.json();
            // The API sometimes returns different shapes (image / artifacts[].base64 etc.)
            const base64 = data.image || data.artifacts?.[0]?.base64 || data.artifacts?.[0]?.b64_json || data.artifacts?.[0]?.base64_image;
            return { base64, raw: data };
        }

        let imageBase64: string | undefined;
        let mimeType = 'image/png';
        let caption = prompt;

        if (STABILITY_KEYS.length > 0) {
            // Try each key in order until one succeeds
            for (let i = 0; i < STABILITY_KEYS.length; i++) {
                const key = STABILITY_KEYS[i];
                try {
                    const stabilityResult = await generateWithStability(prompt, key);
                    imageBase64 = stabilityResult.base64;
                    // Keep caption default — Stability may not return a text caption
                    caption = prompt;
                    // success — stop trying more keys
                    break;
                } catch (stErr: any) {
                    // Log the error without printing the key
                    console.error(`Stability generation failed using key #${i + 1}:`, stErr.message || stErr);
                    // try next key
                    imageBase64 = undefined;
                }
            }
        }

        // If imageBase64 is still undefined, fallback to existing Gemini path
        if (!imageBase64) {
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
                imageBase64 = imagePart.inlineData.data; // base64
                mimeType = imagePart.inlineData.mimeType;
                if (textPart) caption = textPart.text;
            } else {
                return NextResponse.json({
                    status: 'error',
                    message: 'No image part found in Gemini response',
                    prompt: prompt,
                    geminiResponse: imageGenResult.response
                }, { status: 500 });
            }
        }

        if (!imageBase64) {
            return NextResponse.json({ status: 'error', message: 'Failed to generate image from any provider', prompt }, { status: 500 });
        }

        // Upload to Cloudinary
        let imageUrl: string | null = null;
        try {
            const base64ImageWithPrefix = `data:${mimeType};base64,${imageBase64}`;
            const uploadResult = await cloudinary.uploader.upload(base64ImageWithPrefix, {
                folder: "gemini-telegram-images",
                public_id: `generated-${Date.now()}`,
            });
            imageUrl = uploadResult.secure_url;
            console.log("Image uploaded to Cloudinary:", imageUrl);
        } catch (cloudinaryError: any) {
            console.error("Error uploading image to Cloudinary:", cloudinaryError);
            return NextResponse.json({
                status: 'error',
                message: 'Failed to upload image to cloud storage',
                prompt: prompt,
                cloudinaryError: cloudinaryError.message,
            }, { status: 500 });
        }

        return NextResponse.json({
            status: 'success',
            imageUrl,
            message: caption,
            prompt,
            generatedImage: {
                mimeType,
                caption,
                imageUrl,
            }
        });

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