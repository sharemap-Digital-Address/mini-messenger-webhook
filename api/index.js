const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Supabase Connection Settings
const SUPABASE_URL = "https://qeqbnhpvarsdcrdzpycr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_KwWNvUe_KuZatiWB8nVvkQ_56JRPiif";
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Listahan ng mga keywords na magti-trigger sa SDK Button
const TRIGGER_KEYWORDS = ['order', 'bili', 'kiosk', 'dine-in', 'menu', 'pabili', 'buy', 'sharemap'];

// 1. Webhook Verification para sa Meta Console
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "sharemap_secret_123";

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            return res.status(200).send(challenge);
        } else {
            return res.sendStatus(403);
        }
    }
    return res.sendStatus(400);
});

// 2. Event Receiver para sa Incoming Messages & Keyword Matching
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            const pageId = entry.id; // Page ID mula sa Meta

            if (entry.messaging && entry.messaging.length > 0) {
                const webhook_event = entry.messaging[0];
                const sender_psid = webhook_event.sender.id;

                if (webhook_event.message && webhook_event.message.text) {
                    const userMessage = webhook_event.message.text.toLowerCase();
                    console.log(`[INCOMING CHAT] Page ID: ${pageId} | Sender: ${sender_psid} | Message: "${userMessage}"`);

                    // Suriin kung ang mensahe ay naglalaman ng kahit alin sa ating trigger keywords
                    const isKeywordMatched = TRIGGER_KEYWORDS.some(keyword => userMessage.includes(keyword));

                    if (isKeywordMatched) {
                        console.log(`🎯 Keyword Matched! Nagpapadala ng SDK Button...`);
                        
                        // Kuhanin ang active token mula sa Supabase
                        const token = await getStoreAccessToken(pageId);

                        if (token && token !== "OFFLINE_TOKEN_EXPIRED") {
                            await sendMessengerSdkButton(sender_psid, pageId, token);
                        } else {
                            console.error(`⚠️ Walang mahanap na active token sa Supabase para sa Page ID: ${pageId}`);
                        }
                    } else {
                        console.log(`ℹ️ Hindi nag-trigger ang button (no order keywords matched).`);
                    }
                }
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
});

// Function para kumuha ng Token mula sa Supabase gamit ang Page ID o Username
async function getStoreAccessToken(pageId) {
    try {
        // Unang subok: i-match sa page_id (numeric ID)
        let { data, error } = await supabaseClient
            .from('licenses')
            .select('page_access_token, username')
            .eq('page_id', pageId)
            .single();

        if (data && data.page_access_token) {
            return data.page_access_token;
        }

        // Fallback: Kung username lang ang nakatabi
        const cleanedUsername = String(pageId).replace('@', '').toLowerCase().trim();
        const { data: userData } = await supabaseClient
            .from('licenses')
            .select('page_access_token')
            .eq('username', cleanedUsername)
            .single();

        return userData ? userData.page_access_token : null;
    } catch (err) {
        console.error("Error sa pag-lookup sa Supabase:", err);
        return null;
    }
}

// Function para magpadala ng Official Messenger SDK Button Response
async function sendMessengerSdkButton(recipientPsid, storeIdentifier, pageAccessToken) {
    const cleanStorePage = String(storeIdentifier).replace('@', '').toLowerCase().trim();
    
    const messageData = {
        recipient: { id: recipientPsid },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Magandang araw! Pindutin ang button sa ibaba para buksan ang iyong Order Gateway:",
                    buttons: [
                        {
                            type: "web_url",
                            url: `https://sharemap-digital-address.github.io/m.me-kiosk-sellerpage/multigateway.html?page=${encodeURIComponent(cleanStorePage)}`,
                            title: "🚀 Open Order Gateway",
                            messenger_extensions: true, // PINAKA-IMPORTANTE: GAGANA NA ANG SDK!
                            webview_height_ratio: "full"
                        }
                    ]
                }
            }
        }
    };

    try {
        const response = await fetch(`https://graph.facebook.com/v26.0/me/messages?access_token=${pageAccessToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageData)
        });
        const result = await response.json();
        console.log("📤 Naipadala ang SDK Button Response:", result);
    } catch (err) {
        console.error("❌ Error sa pagpapadala ng SDK Button:", err);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server running on port ${PORT}`);
});
