const express = require('express');
const fetch = require('node-fetch'); // Kung wala pa, pwede ring gumamit ng built-in fetch sa Node.js
const app = express();

app.use(express.json());

// Ilagay dito ang Page Access Token ng store o i-set sa environment variables sa Render
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || "IYONG_PAGE_ACCESS_TOKEN_DITO";

// 1. Webhook Verification para sa Meta Developers Console
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

// 2. Event Receiver para sa Incoming Customer Messages & Auto-Reply ng SDK Button
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            if (entry.messaging && entry.messaging.length > 0) {
                const webhook_event = entry.messaging[0];
                const sender_psid = webhook_event.sender.id;

                // Kapag nag-chat ang kustomer, padalhan natin siya ng Button na may SDK Extension
                if (webhook_event.message && webhook_event.message.text) {
                    const received_message = webhook_event.message.text;
                    console.log(`[STORE POS LOG] New Customer PSID: ${sender_psid} | Message: "${received_message}"`);
                    
                    // Tawagin ang function para magpadala ng SDK Button
                    await sendMessengerSdkButton(sender_psid);
                }
            }
        }

        return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
});

// Function para magpadala ng opisyal na Button na may messenger_extensions: true
async function sendMessengerSdkButton(recipientPsid) {
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
                            url: "https://sharemap-digital-address.github.io/m.me-kiosk-sellerpage/multigateway.html?page=sharemapdammystore",
                            title: "🚀 Open Order Gateway",
                            messenger_extensions: true,  // <-- ITO ANG SUSI PARA GUMANA ANG SDK!
                            webview_height_ratio: "full"
                        }
                    ]
                }
            }
        }
    };

    try {
        const response = await fetch(`https://graph.facebook.com/v26.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageData)
        });
        const result = await response.json();
        console.log("📤 Naipadala ang SDK Button kay buyer:", result);
    } catch (err) {
        console.error("❌ Error sa pagpadala ng SDK Button:", err);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server running on port ${PORT}`);
});
