// server.js (for Vercel)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL Connection (Vercel supports SSL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});


// ---------------------------
// Helper Functions
// ---------------------------

async function getLatestTbm9() {
  const sql = `
    SELECT sno,
           operator_id,
           p_shift,
           recipe_name,
           performance,
           production_date,
           drum_changeover
    FROM public.tbm9
    ORDER BY production_date DESC NULLS LAST, sno DESC
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql);
  return rows[0] || null;
}

async function getTotalProductionForDate(date) {
  const sql = `
    SELECT COUNT(*) AS total
    FROM public.tbm9
    WHERE production_date = $1;
  `;
  const { rows } = await pool.query(sql, [date]);
  return Number(rows[0]?.total || 0);
}


// ---------------------------
// API: /api/send-message
// ---------------------------

app.post('/send-message', async (req, res) => {
  try {
    const mobile = (req.body.mobile || '').trim();
    if (!mobile) return res.status(400).json({ error: 'mobile missing' });

    const latest = await getLatestTbm9();
    if (!latest) return res.status(404).json({ error: 'no tbm9 data found' });

    const totalProduction = await getTotalProductionForDate(latest.production_date);

    const machineName = "TBM 1";

    const apiURL = `${process.env.MSGCLUB_URL}?AUTH_KEY=${process.env.MSGCLUB_AUTH_KEY}`;

    const payload = {
      mobileNumbers: mobile,
      senderId: process.env.SENDER_ID,
      component: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        type: "template",
        template: {
          name: "shift_end_template",
          language: { code: "en" },
          components: [
            {
              type: "header",
              index: 0,
              parameters: [
                { type: "text", text: String(latest.p_shift ?? '') }
              ]
            },
            {
              type: "body",
              index: 0,
              parameters: [
                { type: "text", text: machineName },
                { type: "text", text: String(latest.operator_id ?? '') },
                { type: "text", text: String(totalProduction) },
                { type: "text", text: String(Math.round(latest.performance ?? 0)) },
                { type: "text", text: String(latest.drum_changeover ?? 0) }
              ]
            }
          ]
        },
        qrImageUrl: false,
        qrLinkUrl: false,
        to: mobile
      }
    };

    const resp = await axios.post(apiURL, payload, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });

    return res.json({
      status: "sent",
      mobile,
      totalProduction,
      dbRecord: latest,
      msgClub: resp.data
    });

  } catch (err) {
    console.error("ERR", err?.response?.data || err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
});


// ---------------------------------
// ❗ VERY IMPORTANT FOR VERCEL
// ---------------------------------
// Do NOT app.listen() — Vercel manages the server
// Just export the app
module.exports = app;
