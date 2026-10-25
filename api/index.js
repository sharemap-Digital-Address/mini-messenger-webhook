const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// SECURE: Galing sa Render Environment Variables, hindi hardcoded sa GitHub
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // MASTER KEY, hindi ANON
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "sharemap_secret_123";

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TRIGGER_KEYWORDS = ['order', 'bili', 'kiosk', 'dine-in', 'menu', 'pabili', 'buy', 'sharemap'];

// 1. Webhook Verification
app.get('/webhook', (req, res) => {
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

// 2. Event Receiver - NGAYON NAGSE-SAVE NA NG PSID + FULLNAME SA TAMANG CELL
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        for (const entry of body.entry) {
            const pageId = entry.id;

            if (entry.messaging && entry.messaging.length > 0) {
                const webhook_event = entry.messaging[0];
                const sender_psid = webhook_event.sender.id;

                // KUNIN REF PARA MA-MATCH TAMANG ORDER CELL KAHIT MAY SABAY-SABAY
                let refCode = null;
                if (webhook_event.postback && webhook_event.postback.ref) {
                    refCode = webhook_event.postback.ref; // galing sa ?ref=order_A1B2
                }
                if (webhook_event.referral && webhook_event.referral.ref) {
                    refCode = webhook_event.referral.ref;
                }
                if (webhook_event.message && webhook_event.message.quick_reply && webhook_event.message.quick_reply.payload) {
                    refCode = webhook_event.message.quick_reply.payload;
                }

                console.log(`[INCOMING] Page: ${pageId} | PSID: ${sender_psid} | REF: ${refCode}`);

                // KUNIN STORE INFO - ISANG TABLE LANG PARA BAWAS SA QUERY LIMIT
                const storeInfo = await getStoreLicenseInfo(pageId);
                if (!storeInfo || !storeInfo.token) {
                    console.error(`⚠️ Walang token para sa Page ID: ${pageId}`);
                    continue;
                }

                // FETCH FULLNAME KASAMA PSID VIA GRAPH API (sa background, hindi kita sa browser)
                let fullName = 'Customer';
                try {
                    const fbRes = await fetch(`https://graph.facebook.com/v26.0/${sender_psid}?fields=name,profile_pic&access_token=${storeInfo.token}`);
                    const fbUser = await fbRes.json();
                    if (fbUser && fbUser.name) fullName = fbUser.name;
                } catch (e) {
                    console.error('Error fetching name:', e);
                }

                // SAVE / UPDATE SA SUPABASE - TAMANG CELL BY ORDER_ID
                if (refCode && refCode.startsWith('order_')) {
                    const orderId = refCode.replace('order_', '').trim();
                    console.log(`🎯 Ref matched! OrderID: ${orderId} → PSID: ${sender_psid} + Fullname: ${fullName}`);

                    // I-UPDATE YUNG EXISTING ORDER NA MAY ORDER_ID NA YUN - HINDI INSERT NG BAGO
                    // Kaya kahit may 10 sabay na nag-order, tama pa rin cell
                    const { error } = await supabaseClient
                        .from('orders')
                        .update({
                            messenger_psid: sender_psid,
                            customer_name: fullName, // kasama fullname
                            status: 'PSID_MATCHED'
                        })
                        .eq('order_id', orderId)
                        .eq('store_page', storeInfo.username.toLowerCase());

                    if (error) {
                        console.error('Error updating order by ref:', error);
                        // Fallback: kung wala pa order row, mag-insert
                        await supabaseClient.from('orders').insert({
                            order_id: orderId,
                            username: storeInfo.username,
                            store_page: storeInfo.username.toLowerCase(),
                            messenger_psid: sender_psid,
                            customer_name: fullName,
                            status: 'WEBHOOK_PSID'
                        });
                    }
                } else {
                    // WALANG REF - save as temporary by username (para sa POS na naka-active ilang segundo)
                    // Pero mas okay pa rin may ref para sure match
                    if (webhook_event.message && webhook_event.message.text) {
                        const userMessage = webhook_event.message.text.toLowerCase();
                        const isKeywordMatched = TRIGGER_KEYWORDS.some(k => userMessage.includes(k));
                        
                        if (isKeywordMatched) {
                            // Save temporary - POS kukunin lahat by username at buburahin
                            await supabaseClient.from('orders').insert({
                                username: storeInfo.username,
                                store_page: storeInfo.username.toLowerCase(),
                                messenger_psid: sender_psid,
                                customer_name: fullName,
                                orders_list: webhook_event.message.text,
                                status: 'WEBHOOK_TEMP'
                            });
                            await sendMessengerSdkButton(sender_psid, storeInfo.username, storeInfo.token, null);
                        }
                    }
                }

                // SEND BUTTON WITH REF PARA NEXT TIME MAY REF NA
                if (webhook_event.message && webhook_event.message.text) {
                    const userMessage = webhook_event.message.text.toLowerCase();
                    const isKeywordMatched = TRIGGER_KEYWORDS.some(k => userMessage.includes(k));
                    if (isKeywordMatched && !refCode) {
                        await sendMessengerSdkButton(sender_psid, storeInfo.username, storeInfo.token, null);
                    }
                }
            }
        }
        return res.status(200).send('EVENT_RECEIVED');
    }
    return res.sendStatus(404);
});

async function getStoreLicenseInfo(pageId) {
    try {
        // ISANG TABLE LANG - BAWAS SA QUERY LIMIT AT MADALI MAG-DAGDAG VIA CODE
        let { data } = await supabaseClient
            .from('licenses')
            .select('page_access_token, username')
            .eq('page_id', pageId)
            .single();

        if (data && data.page_access_token && data.username) {
            return { token: data.page_access_token, username: data.username.trim() };
        }

        let { data: fallbackData } = await supabaseClient
            .from('licenses')
            .select('page_access_token, username')
            .eq('username', String(pageId).toLowerCase())
            .single();

        if (fallbackData && fallbackData.page_access_token && fallbackData.username) {
            return { token: fallbackData.page_access_token, username: fallbackData.username.trim() };
        }

        return { token: null, username: null };
    } catch (err) {
        console.error("Error lookup Supabase:", err);
        return { token: null, username: null };
    }
}

// UPDATED: May orderId ref na para ma-match tamang cell kahit sabay-sabay
async function sendMessengerSdkButton(recipientPsid, storeUsername, pageAccessToken, orderId = null) {
    if (!storeUsername) return;

    const cleanStorePage = String(storeUsername).replace('@', '').toLowerCase().trim();
    const refParam = orderId ? `&ref=order_${orderId}` : '';
    
    // MAY REF NA KASAMA PARA MA-MATCH TAMANG CELL
    const buttonUrl = `https://sharemap-digital-address.github.io/m.me-kiosk-sellerpage/multigateway.html?page=${encodeURIComponent(cleanStorePage)}&fb_app_id=2070260990400834&messenger_extensions=true${refParam ? `&${refParam}` : ''}`;
    console.log(`🔗 BUTTON URL: ${buttonUrl}`);

    const messageData = {
        recipient: { id: recipientPsid },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: [{
                        title: "📍 ShareMap Order Gateway",
                        subtitle: "Pindutin ang button para buksan ang Kiosk:",
                        buttons: [{
                            type: "web_url",
                            url: buttonUrl,
                            title: "🚀 Open Order Gateway",
                            messenger_extensions: true,
                            webview_height_ratio: "full"
                        }]
                    }]
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
        console.log("📤 SDK Button sent:", result);

        await fetch(`https://graph.facebook.com/v26.0/me/messages?access_token=${pageAccessToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recipient: { id: recipientPsid },
                message: { text: `👉 Direct link:\n${buttonUrl}` }
            })
        });
    } catch (err) {
        console.error("Error sending button:", err);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Webhook server running on port ${PORT}`);
});
