// controllers/artPaymentController.js
const db = require('../config/db');
const linkqu = require('../services/linkquService');
const helpers = require('../utils/helpers');
const { sendToUser, sendToRole } = require('../services/notificationService');
const moment = require('moment-timezone');

// ============================================================
// HELPER: Notifikasi ke admin & pekerja
// ============================================================
const notifyArtOrderPaid = async (connection, pesananId) => {
    const tag = `[notifyArtOrderPaid][Pesanan#${pesananId}]`;

    const [rows] = await connection.execute(
        `SELECT 
            p.id AS pesanan_id,
            p.order_id,
            p.cust_id,
            p.cust_nama,
            p.cust_hp,
            p.worker_id,
            p.worker_nama,
            p.total,
            p.tgl,
            p.jam,
            p.alamat,
            p.catatan
         FROM pesanan p
         WHERE p.id = ?`,
        [pesananId]
    );

    if (rows.length === 0) {
        console.warn(`${tag} ⚠️ Pesanan tidak ditemukan`);
        return;
    }

    const pesanan = rows[0];

    // 1. Notifikasi ke Admin
    try {
        await sendToRole(
            'admin',
            '🧹 Pesanan ART/Babysitter Baru!',
            `Pesanan #${pesanan.order_id} dari ${pesanan.cust_nama} (${pesanan.cust_hp}) untuk ${pesanan.worker_nama} sebesar Rp${parseInt(pesanan.total).toLocaleString('id-ID')}`,
            {
                orderId: String(pesanan.order_id),
                type: 'ADMIN_ART_ORDER',
                screen: 'ArtOrderDetail'
            }
        );
    } catch (err) {
        console.error(`${tag} ❌ Notif Admin error:`, err.message);
    }

    // 2. Notifikasi ke Customer
    try {
        await sendToUser(
            pesanan.cust_id,
            '✅ Pembayaran Berhasil!',
            `Halo ${pesanan.cust_nama}, pembayaran untuk pesanan ART/Babysitter #${pesanan.order_id} telah berhasil. Tim kami akan segera memproses.`,
            {
                orderId: String(pesanan.order_id),
                type: 'ART_PAYMENT_SUCCESS',
                screen: 'ArtOrderDetail'
            }
        );
    } catch (err) {
        console.error(`${tag} ❌ Notif Customer error:`, err.message);
    }

    // 3. Notifikasi ke Pekerja (jika ada)
    if (pesanan.worker_id) {
        try {
            await sendToUser(
                pesanan.worker_id,
                '📋 Pesanan Baru untuk Anda!',
                `Halo ${pesanan.worker_nama}, ada pesanan baru dari ${pesanan.cust_nama} pada ${pesanan.tgl} pukul ${pesanan.jam}.`,
                {
                    orderId: String(pesanan.order_id),
                    type: 'ART_NEW_JOB',
                    screen: 'ArtJobDetail'
                }
            );
        } catch (err) {
            console.error(`${tag} ❌ Notif Pekerja error:`, err.message);
        }
    }
};

// ============================================================
// CREATE PAYMENT untuk ART/Babysitter
// ============================================================
const createArtPayment = async (req, res) => {
    console.log("==========================================");
    console.log("🧹 [ART Payment] Incoming Request");
    console.log("Timestamp:", new Date().toISOString());
    console.log("==========================================");

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const {
            pesanan_id,
            metode_pembayaran,
            total,
            cust_id,
            cust_nama,
            cust_email,
            cust_hp,
            worker_id,
            worker_nama
        } = req.body;

        if (!pesanan_id || !metode_pembayaran || !total) {
            return res.status(400).json({
                success: false,
                message: "Data tidak lengkap"
            });
        }

        const isQRIS = metode_pembayaran === 'QRIS';
        const partner_reff = helpers.generatePartnerReff();

        const duration = isQRIS ? 30 : 1440;
        const expiredMoment = moment().tz('Asia/Jakarta').add(duration, 'minutes');
        const expired = expiredMoment.format('YYYYMMDDHHmmss');
        const formattedExpired = expiredMoment.format('YYYY-MM-DD HH:mm:ss');

        const finalEmail = helpers.isValidEmail(cust_email) ? cust_email : process.env.DEFAULT_EMAIL;

        const payload = {
            amount: total,
            partner_reff: partner_reff,
            expired: expired,
            method: metode_pembayaran,
            nama: cust_nama || 'Customer',
            email: finalEmail,
            customer_id: cust_id,
            wa: cust_hp
        };

        const linkquRes = isQRIS ?
            await linkqu.createQRIS(payload) :
            await linkqu.createVA(payload);

        if (!linkquRes.data || linkquRes.data.status !== 'SUCCESS') {
            throw new Error(linkquRes.data?.message || "Gagal mendapatkan respon dari LinkQu");
        }

        // ✅ SATU QUERY UPDATE - tanpa art_order_logs
        await connection.execute(
            `UPDATE pesanan 
             SET 
                metode_bayar = ?,
                total = ?,
                pay_id = ?,
                pay_method = ?,
                pay_status = 'pending',
                pay_data = ?,
                expired_at = ?,
                status = 'pending',
                matching_status = 'pending'
             WHERE id = ?`,
            [
                metode_pembayaran,
                total,
                partner_reff,
                isQRIS ? 'QRIS' : 'VA',
                JSON.stringify(linkquRes.data),
                formattedExpired,
                pesanan_id
            ]
        );

        await connection.commit();
        console.log(`✅ [ART Payment] Pesanan #${pesanan_id} berhasil dibuat, reff: ${partner_reff}`);

        res.json({
            success: true,
            message: 'Pembayaran ART berhasil dibuat',
            data: {
                pesanan_id: pesanan_id,
                va_number: linkquRes.data.virtual_account || null,
                qris_url: linkquRes.data.imageqris || null,
                expired_at: formattedExpired,
                amount: total,
                partner_reff: partner_reff
            }
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ [ART Payment] Error:", err.message);
        res.status(500).json({
            success: false,
            message: err.message || "Internal Server Error"
        });
    } finally {
        connection.release();
    }
};

// ============================================================
// WEBHOOK CALLBACK untuk ART Payment
// ============================================================
const handleArtCallback = async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { partner_reff, status, amount } = req.body;
        console.log(`📩 [ART Webhook] Reff #${partner_reff} | Status: ${status}`);

        if (status === 'SUCCESS' || status === 'SETTLED') {
            await connection.beginTransaction();

            const [rows] = await connection.execute(
                `SELECT id, pay_status FROM pesanan WHERE pay_id = ?`,
                [partner_reff]
            );

            if (rows.length > 0) {
                const pesananId = rows[0].id;

                // ✅ Update status - tanpa art_order_logs
                await connection.execute(
                    `UPDATE pesanan 
                     SET pay_status = 'settlement', 
                         status = 'paid',
                         matching_status = 'matching',
                         pay_at = NOW() 
                     WHERE pay_id = ?`,
                    [partner_reff]
                );

                await connection.commit();
                console.log(`✅ [ART Webhook] Pesanan #${pesananId} lunas.`);

                await notifyArtOrderPaid(connection, pesananId);
            }
        }
        res.status(200).send("OK");
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("❌ [ART Webhook] Error:", err.message);
        res.status(500).send("Callback Error");
    } finally {
        connection.release();
    }
};

// ============================================================
// CHECK PAYMENT STATUS untuk ART
// ============================================================
const checkArtPaymentStatus = async (req, res) => {
    const { partnerReff } = req.params;
    const connection = await db.getConnection();

    try {
        const [rows] = await connection.execute(
            `SELECT id, pay_status, expired_at, status, matching_status
             FROM pesanan 
             WHERE pay_id = ?`,
            [partnerReff]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Transaksi tidak ditemukan"
            });
        }

        const { id: pesananId, pay_status, expired_at, status, matching_status } = rows[0];

        // Cek expired
        if (pay_status === 'pending' && new Date() > new Date(expired_at)) {
            await connection.beginTransaction();
            await connection.execute(
                `UPDATE pesanan SET pay_status = 'expire', status = 'cancelled', matching_status = 'cancelled' WHERE id = ?`,
                [pesananId]
            );
            await connection.commit();
            return res.json({ success: true, status: 'EXPIRED' });
        }

        // Cek ke LinkQu
        const linkquResult = await linkqu.checkStatus(partnerReff);
        const linkquStatus = linkquResult?.status || linkquResult?.data?.status;

        if (linkquStatus === 'SUCCESS' || linkquStatus === 'SETTLED') {
            await connection.beginTransaction();
            await connection.execute(
                `UPDATE pesanan SET pay_status = 'settlement', status = 'paid', matching_status = 'matching', pay_at = NOW() WHERE id = ?`,
                [pesananId]
            );
            await connection.commit();

            await notifyArtOrderPaid(connection, pesananId);

            return res.json({ success: true, status: 'SUCCESS' });
        }

        res.json({
            success: true,
            status: pay_status.toUpperCase(),
            data: linkquResult
        });

    } catch (err) {
        if (connection) await connection.rollback();
        console.error("[ART CheckPayment] Error:", err.message);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    } finally {
        connection.release();
    }
};

// ============================================================
// EXPORT MODULE
// ============================================================
module.exports = {
    createArtPayment,
    handleArtCallback,
    checkArtPaymentStatus,
    notifyArtOrderPaid
};