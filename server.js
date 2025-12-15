/**
 * MottorPay Push Server v2.0
 * Использует FCM HTTP v1 API (новый стандарт Google)
 * 
 * Для работы нужно:
 * 1. Создать Service Account в Firebase Console
 * 2. Скачать JSON ключ
 * 3. Установить переменную окружения FIREBASE_SERVICE_ACCOUNT с содержимым JSON
 */

const express = require('express');
const cors = require('cors');
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Firebase Project ID
const FIREBASE_PROJECT_ID = 'mottorpay';

// FCM v1 API endpoint
const FCM_URL = `https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`;

// Service Account credentials (из переменной окружения)
let serviceAccount = null;
let auth = null;

// Инициализация credentials
function initCredentials() {
    try {
        const credentialsJson = process.env.FIREBASE_SERVICE_ACCOUNT;
        
        if (!credentialsJson) {
            console.error('❌ FIREBASE_SERVICE_ACCOUNT не установлен!');
            console.log('Для работы сервера нужно:');
            console.log('1. Создать Service Account в Firebase Console');
            console.log('2. Project Settings → Service accounts → Generate new private key');
            console.log('3. Скопировать содержимое JSON в переменную FIREBASE_SERVICE_ACCOUNT');
            return false;
        }
        
        serviceAccount = JSON.parse(credentialsJson);
        
        auth = new GoogleAuth({
            credentials: serviceAccount,
            scopes: ['https://www.googleapis.com/auth/firebase.messaging']
        });
        
        console.log('✅ Firebase credentials инициализированы');
        console.log(`   Project: ${serviceAccount.project_id}`);
        console.log(`   Client Email: ${serviceAccount.client_email}`);
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка парсинга credentials:', error.message);
        return false;
    }
}

// Получение access token для FCM v1 API
async function getAccessToken() {
    if (!auth) {
        throw new Error('Credentials не инициализированы');
    }
    
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token;
}

// Отправка push через FCM v1 API
async function sendPushV1(token, title, body, data = {}) {
    const accessToken = await getAccessToken();
    
    // Формируем сообщение по спецификации FCM v1
    const message = {
        message: {
            token: token,
            notification: {
                title: title,
                body: body
            },
            data: {
                ...data,
                click_action: data.url || '/investor.html'
            },
            webpush: {
                notification: {
                    title: title,
                    body: body,
                    icon: '/icon-192.png',
                    badge: '/icon-72.png',
                    vibrate: [200, 100, 200],
                    requireInteraction: false,
                    tag: data.tag || 'mottorpay-' + Date.now()
                },
                fcm_options: {
                    link: data.url || '/investor.html'
                }
            },
            android: {
                priority: 'high',
                notification: {
                    title: title,
                    body: body,
                    icon: 'ic_notification',
                    color: '#5B67CA',
                    sound: 'default',
                    click_action: 'OPEN_APP'
                }
            },
            apns: {
                payload: {
                    aps: {
                        alert: {
                            title: title,
                            body: body
                        },
                        badge: 1,
                        sound: 'default'
                    }
                }
            }
        }
    };
    
    const response = await fetch(FCM_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
    });
    
    const result = await response.json();
    
    if (!response.ok) {
        console.error('❌ FCM Error:', result);
        throw new Error(result.error?.message || 'FCM request failed');
    }
    
    return result;
}

// =====================================================
// API ENDPOINTS
// =====================================================

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        version: '2.0.0',
        api: 'FCM HTTP v1',
        project: FIREBASE_PROJECT_ID,
        credentialsLoaded: !!serviceAccount,
        timestamp: new Date().toISOString()
    });
});

// Health check (альтернативный endpoint)
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

// Отправка push-уведомления
app.post('/', async (req, res) => {
    console.log('📨 Получен запрос на отправку push');
    
    try {
        const { token, title, body, data } = req.body;
        
        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Token is required'
            });
        }
        
        if (!serviceAccount) {
            return res.status(500).json({
                success: false,
                error: 'Server not configured. FIREBASE_SERVICE_ACCOUNT not set.'
            });
        }
        
        console.log(`   Token: ${token.substring(0, 20)}...`);
        console.log(`   Title: ${title}`);
        console.log(`   Body: ${body}`);
        
        const result = await sendPushV1(
            token,
            title || 'MottorPay',
            body || 'Новое уведомление',
            data || {}
        );
        
        console.log('✅ Push отправлен:', result.name);
        
        res.json({
            success: true,
            messageId: result.name
        });
        
    } catch (error) {
        console.error('❌ Ошибка отправки:', error.message);
        
        // Определяем тип ошибки
        let errorType = 'unknown';
        if (error.message.includes('not found') || error.message.includes('not a valid FCM')) {
            errorType = 'invalid_token';
        } else if (error.message.includes('not registered')) {
            errorType = 'unregistered';
        }
        
        res.status(500).json({
            success: false,
            error: error.message,
            errorType: errorType
        });
    }
});

// Отправка push нескольким пользователям
app.post('/batch', async (req, res) => {
    console.log('📨 Batch push request');
    
    try {
        const { tokens, title, body, data } = req.body;
        
        if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Tokens array is required'
            });
        }
        
        const results = {
            success: 0,
            failed: 0,
            errors: []
        };
        
        for (const token of tokens) {
            try {
                await sendPushV1(token, title, body, data);
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    token: token.substring(0, 20) + '...',
                    error: error.message
                });
            }
        }
        
        console.log(`✅ Batch complete: ${results.success} sent, ${results.failed} failed`);
        
        res.json({
            success: true,
            results
        });
        
    } catch (error) {
        console.error('❌ Batch error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Тестовый endpoint
app.post('/test', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({
            success: false,
            error: 'Token required for test'
        });
    }
    
    try {
        const result = await sendPushV1(
            token,
            '🧪 Тестовое уведомление',
            'Push-уведомления работают!',
            { type: 'test', url: '/investor.html' }
        );
        
        res.json({
            success: true,
            message: 'Test push sent!',
            messageId: result.name
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// =====================================================
// ЗАПУСК СЕРВЕРА
// =====================================================
const credentialsOk = initCredentials();

app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  MottorPay Push Server v2.0');
    console.log('  FCM HTTP v1 API');
    console.log('========================================');
    console.log(`  Port: ${PORT}`);
    console.log(`  Status: ${credentialsOk ? '✅ Ready' : '⚠️ No credentials'}`);
    console.log('========================================');
    console.log('');
    
    if (!credentialsOk) {
        console.log('⚠️  Сервер работает, но push не будут отправляться');
        console.log('    Установите переменную FIREBASE_SERVICE_ACCOUNT');
    }
});
