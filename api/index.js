const express = require('express');
const app = express();

app.use(express.json());

// 1. Webhook Verification para sa Meta / Facebook Developers
app.get('/api', (req, res) => {
    const VERIFY_TOKEN = "sharemap_secret_123"; // Pwedeng baguhin ang password na ito

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

// 2. Pagsupsop ng Unang Mensahe at PSID mula sa Kustomer
app.post('/api', (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            if (entry.messaging && entry.messaging.length > 0) {
                const webhook_event = entry.messaging[0];

                // KUNIN ANG PSID AT MENSAHE NG KUSTOMER
                const sender_psid = webhook_event.sender.id;

                if (webhook_event.message && webhook_event.message.text) {
                    const received_message = webhook_event.message.text;
                    console.log(`[STORE POS LOG] New Customer PSID: ${sender_psid} | Message: "${received_message}"`);
                    
                    // Dito pwedeng i-save o i-forward sa POS / Database mo
                }
            }
        });

        return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
});

module.exports = app;
