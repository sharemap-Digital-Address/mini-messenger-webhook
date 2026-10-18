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

                    const isKeywordMatched = TRIGGER_KEYWORDS.some(keyword => userMessage.includes(keyword));

                    if (isKeywordMatched) {
                        console.log(`🎯 Keyword Matched! Kinukuha ang store license details sa Supabase...`);
                        
                        // Kuhanin ang token at ang tamang store username mula sa Supabase
                        const storeInfo = await getStoreLicenseInfo(pageId);

                        if (storeInfo && storeInfo.token && storeInfo.token !== "OFFLINE_TOKEN_EXPIRED") {
                            await sendMessengerSdkButton(sender_psid, storeInfo.username, storeInfo.token);
                        } else {
                            console.error(`⚠️ Walang mahanap na active token o lisensya para sa Page ID: ${pageId}`);
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

// Function para kumuha ng Token AT Username galing sa Supabase gamit ang Page ID
async function getStoreLicenseInfo(pageId) {
    try {
        // I-match sa page_id (numeric ID)
        let { data, error } = await supabaseClient
            .from('licenses')
            .select('page_access_token, username')
            .eq('page_id', pageId)
            .single();

        if (data && data.page_access_token) {
            const storeUsername = (data.username && data.username.trim() !== "") ? data.username : "sharemapdammystore";
            return {
                token: data.page_access_token,
                username: storeUsername
            };
        }

        // Fallback Kung Page ID ang nakasulat sa username column
        let { data: fallbackData } = await supabaseClient
            .from('licenses')
            .select('page_access_token, username')
            .eq('username', String(pageId))
            .single();

        if (fallbackData && fallbackData.page_access_token) {
            return {
                token: fallbackData.page_access_token,
                username: "sharemapdammystore"
            };
        }

        return {
            token: null,
            username: "sharemapdammystore"
        };
    } catch (err) {
        console.error("Error sa pag-lookup sa Supabase:", err);
        return {
            token: null,
            username: "sharemapdammystore"
        };
    }
}

// Function para magpadala ng Official Messenger SDK Button Response at i-log ang link
async function sendMessengerSdkButton(recipientPsid, storeUsername, pageAccessToken) {
    const cleanStorePage = String(storeUsername || "sharemapdammystore").replace('@', '').toLowerCase().trim();
    
    // Bubuuin at ila-log natin ang eksaktong URL dito
    const buttonUrl = `https://sharemap-digital-address.github.io/m.me-kiosk-sellerpage/multigateway.html?page=${encodeURIComponent(cleanStorePage)}`;
    console.log(`🔗 GENERATED BUTTON URL: ${buttonUrl}`);

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
                            url: buttonUrl,
                            title: "🚀 Open Order Gateway",
                            messenger_extensions: true,
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
