import dotenv from "dotenv";
dotenv.config();

import express from "express";
import axios from "axios";
import cors from "cors";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app first
const app = express();
app.use(cors());

// Serve frontend files
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 5000;
const CTA_TRAIN_KEY = process.env.CTA_TRAIN_KEY;
const CTA_BUS_KEY = process.env.CTA_BUS_KEY;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ---------- Helper ----------
async function fetchCTAData(url, res, type) {
    try {
        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        console.error(`Error fetching ${type} data:`, error.message);
        res.status(500).json({ error: `Failed to fetch ${type} data` });
    }
}


// ---------- Routes ----------
app.get("/", (req, res) => res.send("CTA Ventra API is running..."));

//Train data
app.get("/api/trains/:route", (req, res) => {
    const route = req.params.route;
    const url = `https://lapi.transitchicago.com/api/1.0/ttpositions.aspx?key=${CTA_TRAIN_KEY}&rt=${route}&outputType=JSON`;
    fetchCTAData(url, res, "train");
});

// Bus data
app.get("/api/buses/:route", async (req, res) => {
    const route = req.params.route;
    if (!route) return res.status(400).json({ error: "Bus route is required" });

    try {
        const vehiclesUrl = `https://www.ctabustracker.com/bustime/api/v3/getvehicles?key=${CTA_BUS_KEY}&rt=${route}&format=json`;
        const vehiclesRes = await axios.get(vehiclesUrl);
        const vehicles = vehiclesRes.data["bustime-response"].vehicle || [];

        res.json({ route, vehicles });
    } catch (err) {
        console.error("Error fetching bus data:", err.message);
        res.status(500).json({ error: "Failed to fetch bus info" });
    }
});

// CTA service alerts
app.get("/api/alerts", async (req, res) => {
    const { routeid, activeonly, planned, accessibility } = req.query;

    let url = `https://www.transitchicago.com/api/1.0/alerts.aspx?outputType=JSON`;
    if (routeid) url += `&routeid=${encodeURIComponent(routeid)}`;
    if (activeonly) url += `&activeonly=${activeonly}`;
    if (planned) url += `&planned=${planned}`;
    if (accessibility) url += `&accessibility=${accessibility}`;

    try {
        const response = await axios.get(url);
        const data = response.data?.CTAAlerts;
        if (!data) return res.status(500).json({ error: "Unexpected CTA API response" });

        const alerts = Array.isArray(data.Alert) ? data.Alert : [data.Alert];
        const formattedAlerts = alerts.map(alert => ({
            id: alert.AlertId,
            headline: alert.Headline,
            shortDescription: alert.ShortDescription,
            fullDescription: alert.FullDescription?.["#cdata-section"] || alert.FullDescription,
            severity: {
                score: alert.SeverityScore,
                color: `#${alert.SeverityColor}`,
                type: alert.SeverityCSS,
            },
            impact: alert.Impact,
            eventStart: alert.EventStart,
            eventEnd: alert.EventEnd || null,
            openEnded: alert.TBD === "1",
            majorAlert: alert.MajorAlert === "1",
            url: alert.AlertURL?.["#cdatasection"] || null,
            impactedServices: (() => {
                const impacted = alert.ImpactedService?.Service;
                if (!impacted) return [];
                return Array.isArray(impacted) ? impacted : [impacted];
            })().map(service => ({
                type: service.ServiceTypeDescription,
                name: service.ServiceName,
                id: service.ServiceId,
                colors: {
                    background: `#${service.ServiceBackColor}`,
                    text: `#${service.ServiceTextColor}`,
                },
                url: service.ServiceURL?.["#cdatasection"] || "",
            })),
        }));

        res.json({
            timestamp: data.TimeStamp,
            alerts: formattedAlerts,
        });
    } catch (err) {
        console.error("Error fetching detailed alerts:", err.message);
        res.status(500).json({ error: "Failed to fetch CTA alerts" });
    }
});


// ---------- Google Maps API Integration ----------

// (1) Serve the Google Maps key (only for development use)
app.get("/api/google-key", (req, res) => {
    // Optional: Restrict this so you don’t leak your key in production
    if (process.env.NODE_ENV === "production") {
        return res.status(403).json({ error: "Google Maps key not available in production" });
    }
    res.json({ key: GOOGLE_MAPS_API_KEY });
});

// (2) Proxy to Google Places API for nearby bus/train stops
app.get("/api/nearby", async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

    try {
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
        const response = await axios.get(url, {
            params: {
                location: `${lat},${lng}`,
                radius: 600, // meters
                keyword: "Bus",
                key: GOOGLE_MAPS_API_KEY,
            },
        });
        res.json(response.data);
    } catch (error) {
        console.error("Error fetching nearby places:", error.message);
        res.status(500).json({ error: "Failed to fetch nearby locations" });
    }
});


// ---------- Start Server ----------
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
