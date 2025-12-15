export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    const { token, title, body, data } = req.body;
    
    if (!token) {
        return res.status(400).json({ error: 'Token required' });
    }
    
    try {
        const message = {
            message: {
                token: token,
                notification: {
                    title: title || 'MottorPay',
                    body: body || 'Новое уведомление'
                },
                data: data || {},
                webpush: {
                    fcm_options: {
                        link: data?.url || 'https://mottorpay.netlify.app/investor.html'
                    }
                }
            }
        };
        
        // Получаем access token
        const accessToken = await getAccessToken();
        
        // Отправляем через FCM HTTP v1 API
        const response = await fetch(
            'https://fcm.googleapis.com/v1/projects/mottorpay/messages:send',
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(message)
            }
        );
        
        const result = await response.json();
        
        if (response.ok) {
            return res.status(200).json({ success: true, messageId: result.name });
        } else {
            return res.status(400).json({ error: result.error?.message || 'FCM error' });
        }
        
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}

// Получение OAuth2 токена для FCM
async function getAccessToken() {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    
    const jwt = await createJWT(serviceAccount);
    
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    const data = await response.json();
    return data.access_token;
}

// Создание JWT для Google OAuth
async function createJWT(serviceAccount) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    
    const payload = {
        iss: serviceAccount.client_email,
        sub: serviceAccount.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/firebase.messaging'
    };
    
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    
    const signature = await sign(signatureInput, serviceAccount.private_key);
    
    return `${signatureInput}.${signature}`;
}

function base64url(str) {
    return Buffer.from(str).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function sign(data, privateKey) {
    const crypto = await import('crypto');
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(data);
    const signature = sign.sign(privateKey, 'base64');
    return signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
