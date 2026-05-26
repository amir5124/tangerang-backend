const db = require('../config/db'); // Sesuaikan dengan path database Anda

// Data bank Indonesia untuk dropdown
const BANK_LIST = [
    { code: '009', name: 'BNI' },
    { code: '008', name: 'Mandiri' },
    { code: '002', name: 'BRI' },
    { code: '014', name: 'BCA' },
    { code: '022', name: 'CIMB Niaga' },
    { code: '011', name: 'Danamon' },
    { code: '013', name: 'Permata' },
    { code: '426', name: 'Bank Mega' },
    { code: '147', name: 'Bank Muamalat' },
    { code: '451', name: 'Bank Syariah Indonesia' },
    { code: '023', name: 'Bank UOB Indonesia' },
    { code: '016', name: 'Bank Maybank' },
    { code: '019', name: 'Bank Panin' },
    { code: '200', name: 'Bank BTN' },
    { code: '028', name: 'Bank OCBC NISP' },
    { code: '087', name: 'Bank Neo Commerce' },
    { code: '484', name: 'Bank Jago' },
    { code: '947', name: 'Bank Aladin Syariah' },
    { code: '542', name: 'Bank BCA Syariah' }
];

// Get list bank untuk dropdown
exports.getBankList = async (req, res) => {
    try {
        res.json({
            success: true,
            data: BANK_LIST
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data bank',
            error: error.message
        });
    }
};

// Tambah rekening bank
exports.addBankAccount = async (req, res) => {
    const connection = await db.getConnection();

    try {
        const userId = req.user.id;
        const { bank_code, account_number, account_name } = req.body;

        // Validasi input
        if (!bank_code || !account_number || !account_name) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        // Validasi nomor rekening hanya angka
        if (!/^\d+$/.test(account_number)) {
            return res.status(400).json({
                success: false,
                message: 'Nomor rekening hanya boleh berisi angka'
            });
        }

        // Cek apakah bank_code valid
        const selectedBank = BANK_LIST.find(bank => bank.code === bank_code);
        if (!selectedBank) {
            return res.status(400).json({
                success: false,
                message: 'Kode bank tidak valid'
            });
        }

        // Cek jumlah rekening yang sudah tersimpan
        const [countResult] = await connection.execute(
            'SELECT COUNT(*) as total FROM bank_accounts WHERE user_id = ?',
            [userId]
        );

        if (countResult[0].total >= 2) {
            return res.status(400).json({
                success: false,
                message: 'Maksimal 2 rekening bank dapat disimpan'
            });
        }

        // Cek apakah nomor rekening sudah terdaftar untuk user ini
        const [existingAccount] = await connection.execute(
            'SELECT id FROM bank_accounts WHERE user_id = ? AND account_number = ?',
            [userId, account_number]
        );

        if (existingAccount.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Nomor rekening sudah terdaftar'
            });
        }

        // Jika ini adalah rekening pertama, jadikan active = true
        const isFirstAccount = countResult[0].total === 0;

        // Insert rekening baru
        const [result] = await connection.execute(
            `INSERT INTO bank_accounts (user_id, bank_code, bank_name, account_number, account_name, is_active) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, bank_code, selectedBank.name, account_number, account_name, isFirstAccount]
        );

        res.status(201).json({
            success: true,
            message: 'Rekening bank berhasil ditambahkan',
            data: {
                id: result.insertId,
                is_active: isFirstAccount
            }
        });

    } catch (error) {
        console.error('Error addBankAccount:', error);
        res.status(500).json({
            success: false,
            message: 'Terjadi kesalahan saat menambahkan rekening',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

// Get semua rekening bank user
exports.getBankAccounts = async (req, res) => {
    try {
        const userId = req.user.id;

        const [accounts] = await db.execute(
            `SELECT id, bank_code, bank_name, account_number, account_name, is_active, 
                    DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at,
                    DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') as updated_at
             FROM bank_accounts 
             WHERE user_id = ? 
             ORDER BY is_active DESC, created_at DESC`,
            [userId]
        );

        const [countResult] = await db.execute(
            'SELECT COUNT(*) as total FROM bank_accounts WHERE user_id = ?',
            [userId]
        );

        res.json({
            success: true,
            data: accounts,
            meta: {
                total_accounts: countResult[0].total,
                max_accounts: 2,
                remaining_slots: Math.max(0, 2 - countResult[0].total)
            }
        });

    } catch (error) {
        console.error('Error getBankAccounts:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data rekening',
            error: error.message
        });
    }
};

// Update rekening bank
exports.updateBankAccount = async (req, res) => {
    try {
        const userId = req.user.id;
        const accountId = req.params.id;
        const { bank_code, account_number, account_name } = req.body;

        // Validasi input
        if (!bank_code || !account_number || !account_name) {
            return res.status(400).json({
                success: false,
                message: 'Semua field harus diisi'
            });
        }

        // Validasi nomor rekening hanya angka
        if (!/^\d+$/.test(account_number)) {
            return res.status(400).json({
                success: false,
                message: 'Nomor rekening hanya boleh berisi angka'
            });
        }

        // Cek apakah bank_code valid
        const selectedBank = BANK_LIST.find(bank => bank.code === bank_code);
        if (!selectedBank) {
            return res.status(400).json({
                success: false,
                message: 'Kode bank tidak valid'
            });
        }

        // Cek apakah rekening milik user
        const [accountCheck] = await db.execute(
            'SELECT id FROM bank_accounts WHERE id = ? AND user_id = ?',
            [accountId, userId]
        );

        if (accountCheck.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Rekening tidak ditemukan'
            });
        }

        // Cek duplikat nomor rekening (kecuali rekening yang sedang diupdate)
        const [duplicateCheck] = await db.execute(
            'SELECT id FROM bank_accounts WHERE user_id = ? AND account_number = ? AND id != ?',
            [userId, account_number, accountId]
        );

        if (duplicateCheck.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Nomor rekening sudah terdaftar untuk rekening lain'
            });
        }

        // Update rekening
        await db.execute(
            `UPDATE bank_accounts 
             SET bank_code = ?, bank_name = ?, account_number = ?, account_name = ?, updated_at = NOW()
             WHERE id = ? AND user_id = ?`,
            [bank_code, selectedBank.name, account_number, account_name, accountId, userId]
        );

        res.json({
            success: true,
            message: 'Rekening bank berhasil diupdate'
        });

    } catch (error) {
        console.error('Error updateBankAccount:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengupdate rekening',
            error: error.message
        });
    }
};

// Hapus rekening bank
exports.deleteBankAccount = async (req, res) => {
    const connection = await db.getConnection();

    try {
        const userId = req.user.id;
        const accountId = req.params.id;

        await connection.beginTransaction();

        // Cek apakah rekening milik user
        const [accountCheck] = await connection.execute(
            'SELECT is_active FROM bank_accounts WHERE id = ? AND user_id = ?',
            [accountId, userId]
        );

        if (accountCheck.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Rekening tidak ditemukan'
            });
        }

        const wasActive = accountCheck[0].is_active;

        // Hapus rekening
        await connection.execute(
            'DELETE FROM bank_accounts WHERE id = ? AND user_id = ?',
            [accountId, userId]
        );

        // Jika yang dihapus adalah rekening aktif, dan masih ada rekening lain, 
        // jadikan rekening pertama sebagai aktif
        if (wasActive) {
            const [remainingAccounts] = await connection.execute(
                'SELECT id FROM bank_accounts WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
                [userId]
            );

            if (remainingAccounts.length > 0) {
                await connection.execute(
                    'UPDATE bank_accounts SET is_active = TRUE WHERE id = ?',
                    [remainingAccounts[0].id]
                );
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Rekening bank berhasil dihapus'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error deleteBankAccount:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menghapus rekening',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

// Set rekening sebagai aktif (utama)
exports.setActiveBankAccount = async (req, res) => {
    const connection = await db.getConnection();

    try {
        const userId = req.user.id;
        const accountId = req.params.id;

        await connection.beginTransaction();

        // Cek apakah rekening milik user
        const [accountCheck] = await connection.execute(
            'SELECT id FROM bank_accounts WHERE id = ? AND user_id = ?',
            [accountId, userId]
        );

        if (accountCheck.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Rekening tidak ditemukan'
            });
        }

        // Non-aktifkan semua rekening user
        await connection.execute(
            'UPDATE bank_accounts SET is_active = FALSE WHERE user_id = ?',
            [userId]
        );

        // Aktifkan rekening yang dipilih
        await connection.execute(
            'UPDATE bank_accounts SET is_active = TRUE WHERE id = ?',
            [accountId]
        );

        await connection.commit();

        res.json({
            success: true,
            message: 'Rekening utama berhasil diubah'
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error setActiveBankAccount:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengubah rekening utama',
            error: error.message
        });
    } finally {
        connection.release();
    }
};

// Get rekening aktif
exports.getActiveBankAccount = async (req, res) => {
    try {
        const userId = req.user.id;

        const [activeAccount] = await db.execute(
            `SELECT id, bank_code, bank_name, account_number, account_name 
             FROM bank_accounts 
             WHERE user_id = ? AND is_active = TRUE 
             LIMIT 1`,
            [userId]
        );

        res.json({
            success: true,
            data: activeAccount[0] || null
        });

    } catch (error) {
        console.error('Error getActiveBankAccount:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil rekening aktif',
            error: error.message
        });
    }
};