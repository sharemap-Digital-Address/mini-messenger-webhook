const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// 1. Webhook Verification (Kapag kinonekta mo na kay Meta)
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "sharemap_secret_123"; // Palitan mo kung gusto mo ng ibang password

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// 2. Dito sasagutin at sasagapin ni Server ang mga papasok na mensahe (First-time message / PSID)
app.post('/webhook', (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            // Kunin ang messaging event
            const webhook_event = entry.messaging[0];
            console.log("Webhook Event Received:", webhook_event);

            // Narito ang PSID ng kustomer!
            const sender_psid = webhook_event.sender.id;
            console.log(`Sender PSID: ${sender_psid}`);

            // Kung nagpadala ng mensahe ang kustomer
            if (webhook_event.message && webhook_event.message.text) {
                const received_message = webhook_event.message.text;
                console.log(`Mensahing natanggap: "${received_message}" mula sa PSID: ${sender_psid}`);
                
                // Dito mo pwedeng i-save o i-forward ang PSID at mensahe
            }
        });

        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// Port configuration para sa libreng hosting
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server is running on port ${PORT}`);
});
