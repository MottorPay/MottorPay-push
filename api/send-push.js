const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        return res.end();
    }
    
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('MottorPay Push Server is running!');
    }
    
    if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { token, title, body: msgBody, data } = JSON.parse(body);
            
            if (!token) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Token required' }));
            }
            
            const accessToken = await getAccessToken();
            
            const message = {
                message: {
                    token: token,
                    notification: {
                        title: title || 'MottorPay',
                        body: msgBody || 'Новое уведомление'
                    },
                    data: data || {},
                    webpush: {
                        fcm_options: {
                            link: data?.url || 'https://mottorpay.netlify.app/investor.html'
                        }
                    }
                }
            };
            
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
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, messageId: result.name }));
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: result.error?.message || 'FCM error' }));
            }
        } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error.message }));
        }
    });
});

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

async function createJWT(sa) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: sa.client_email,
        sub: sa.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/firebase.messaging'
    };
    
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const signInput = `${b64(header)}.${b64(payload)}`;
    
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signInput);
    const signature = sign.sign(sa.private_key, 'base64url');
    
    return `${signInput}.${signature}`;
}

server.listen(PORT, () => {
    console.log(`Push server running on port ${PORT}`);
});
