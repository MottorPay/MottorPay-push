/**
 * MottorPay Push Server v3.0
 * Чистый Web Push без Firebase
 * Работает на ВСЕХ браузерах и устройствах
 */

const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

// VAPID ключи (сгенерированы через web-push generate-vapid-keys)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BEeLL5hSeIUfXNG_O0g1zyjpXkAThGYWvfubpHm2nafPl97JoiXON4b_rKJeyf0_QOokb0OFaLHC8agXtBiXQuc';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '1bJMMeAybQj-hr3O0Z4w9ct_NKLd7Yk-XxMMblpyZs4';

// Настройка VAPID
webpush.setVapidDetails(
    'mailto:support@mottorpay.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
);

// Middleware
app.use(cors());
app.use(express.json());

// ========================================
// ENDPOINTS
// ========================================

// Health check + публичный ключ
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        version: '3.0.0',
        api: 'Web Push (без Firebase)',
        vapidPublicKey: VAPID_PUBLIC_KEY,
        timestamp: new Date().toISOString()
    });
});

// Получить публичный VAPID ключ (для клиента)
app.get('/vapid-key', (req, res) => {
    res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Отправить push-уведомление
app.post('/send', async (req, res) => {
    try {
        const { subscription, title, body, data } = req.body;

        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({
                success: false,
                error: 'subscription is required'
            });
        }

        const payload = JSON.stringify({
            title: title || 'MottorPay',
            body: body || 'Новое уведомление',
            icon: '/icon-192.png',
            badge: '/icon-72.png',
            data: data || {}
        });

        const options = {
            TTL: 0, // критический приоритет - показать сразу как heads-up
            urgency: 'high'
        };

        await webpush.sendNotification(subscription, payload, options);

        console.log('✅ Push отправлен:', subscription.endpoint.substring(0, 50) + '...');

        res.json({
            success: true,
            message: 'Push sent'
        });

    } catch (error) {
        console.error('❌ Ошибка отправки:', error.message);

        // Определяем тип ошибки
        let errorType = 'unknown';
        let statusCode = 500;

        if (error.statusCode === 410 || error.statusCode === 404) {
            errorType = 'subscription_expired';
            statusCode = 410;
        } else if (error.statusCode === 401) {
            errorType = 'unauthorized';
        }

        res.status(statusCode).json({
            success: false,
            error: error.message,
            errorType: errorType
        });
    }
});

// Отправить нескольким подписчикам
app.post('/send-batch', async (req, res) => {
    try {
        const { subscriptions, title, body, data } = req.body;

        if (!subscriptions || !Array.isArray(subscriptions)) {
            return res.status(400).json({
                success: false,
                error: 'subscriptions array is required'
            });
        }

        const payload = JSON.stringify({
            title: title || 'MottorPay',
            body: body || 'Новое уведомление',
            icon: '/icon-192.png',
            badge: '/icon-72.png',
            data: data || {}
        });

        const results = {
            sent: 0,
            failed: 0,
            expired: []
        };

        for (const subscription of subscriptions) {
            try {
                await webpush.sendNotification(subscription, payload, { TTL: 0, urgency: 'high' });
                results.sent++;
            } catch (error) {
                results.failed++;
                if (error.statusCode === 410 || error.statusCode === 404) {
                    results.expired.push(subscription.endpoint);
                }
            }
        }

        console.log(`📨 Batch: ${results.sent} sent, ${results.failed} failed`);

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

// Тест отправки
app.post('/test', async (req, res) => {
    try {
        const { subscription } = req.body;

        if (!subscription) {
            return res.status(400).json({
                success: false,
                error: 'subscription required'
            });
        }

        const payload = JSON.stringify({
            title: '🧪 Тест',
            body: 'Push-уведомления работают!',
            icon: '/icon-192.png',
            data: { type: 'test' }
        });

        await webpush.sendNotification(subscription, payload, { TTL: 0, urgency: 'high' });

        res.json({
            success: true,
            message: 'Test push sent!'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ========================================
// ЗАПУСК
// ========================================

app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  MottorPay Push Server v3.0');
    console.log('  Pure Web Push (без Firebase)');
    console.log('========================================');
    console.log(`  Port: ${PORT}`);
    console.log(`  VAPID Public Key: ${VAPID_PUBLIC_KEY.substring(0, 20)}...`);
    console.log('========================================');
    console.log('');
});
