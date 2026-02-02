const db = require('../config/db');
const fs = require('fs');
const path = require('path');

// 1. Tambah Jasa Baru
exports.createService = async (req, res) => {
    try {
        const { store_id, service_name, price, price_type, description } = req.body;
        const image_url = req.file ? `/uploads/services/${req.file.filename}` : null;

        const query = `
            INSERT INTO services (store_id, service_name, price_type, base_price, image_url, description) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        const [result] = await db.query(query, [
            store_id,
            service_name,
            price_type || 'fixed',
            price,
            image_url,
            description || null
        ]);

        res.status(201).json({
            message: "Jasa berhasil ditambahkan",
            serviceId: result.insertId,
            image_url
        });
    } catch (err) {
        console.error(">>> [Error] createService:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// 2. Ambil Daftar Jasa per Toko
exports.getServicesByStore = async (req, res) => {
    const { store_id } = req.params;
    const query = "SELECT * FROM services WHERE store_id = ?";
    try {
        const [results] = await db.query(query, [store_id]);
        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. EDIT / UPDATE JASA
exports.updateService = async (req, res) => {
    const { id } = req.params;
    const { service_name, price, price_type, description } = req.body;

    try {
        // Ambil data lama untuk cek foto lama jika ada upload baru
        const [oldData] = await db.query("SELECT image_url FROM services WHERE id = ?", [id]);

        let query = `UPDATE services SET service_name=?, base_price=?, price_type=?, description=?`;
        let params = [service_name, price, price_type || 'fixed', description];

        if (req.file) {
            const new_image_url = `/uploads/services/${req.file.filename}`;
            query += `, image_url=?`;
            params.push(new_image_url);

            // (Opsional) Hapus file fisik lama jika ada
            if (oldData[0]?.image_url) {
                const oldPath = path.join(__dirname, '..', oldData[0].image_url);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
        }

        query += ` WHERE id=?`;
        params.push(id);

        const [result] = await db.query(query, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Jasa tidak ditemukan" });
        }

        res.json({ message: "Jasa berhasil diperbarui" });
    } catch (err) {
        console.error(">>> [Error] updateService:", err.message);
        res.status(500).json({ error: err.message });
    }
};

// 4. Hapus Jasa
exports.deleteService = async (req, res) => {
    const { id } = req.params;
    try {
        // Hapus file fisik sebelum hapus record di DB
        const [service] = await db.query("SELECT image_url FROM services WHERE id = ?", [id]);
        if (service[0]?.image_url) {
            const filePath = path.join(__dirname, '..', service[0].image_url);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        const [result] = await db.query("DELETE FROM services WHERE id = ?", [id]);
        if (result.affectedRows === 0) return res.status(404).json({ message: "Jasa tidak ditemukan" });

        res.json({ message: "Jasa berhasil dihapus" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};