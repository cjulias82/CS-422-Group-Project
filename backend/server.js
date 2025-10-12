import dotenv from "dotenv";
dotenv.config();

import express from "express";
import axios from "axios";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;
const CTA_TRAIN_KEY = process.env.CTA_TRAIN_KEY;
const CTA_BUS_KEY = process.env.CTA_BUS_KEY;

//console.log("Train Key:", CTA_TRAIN_KEY);
//console.log("Bus Key:", CTA_BUS_KEY);

// Helper function to fetch CTA data
async function fetchCTAData(url, res, type) {
    try {
        const response = await axios.get(url);
        res.json(response.data);
    } catch (error) {
        console.error(`Error fetching ${type} data:`, error.message);
        res.status(500).json({ error: `Failed to fetch ${type} data` });
    }
}


app.get("/", (req, res) => res.send("CTA Ventra API is running..."));

// Train data by route (e.g., Red, Blue, etc.)
app.get("/api/trains/:route", (req, res) => {
    const route = req.params.route;
    const url = `https://lapi.transitchicago.com/api/1.0/ttpositions.aspx?key=${CTA_TRAIN_KEY}&rt=${route}&outputType=JSON`;
    fetchCTAData(url, res, "train");
});

// Bus data by route
app.get("/api/buses/:route", async (req, res) => {
    const route = req.params.route;
    if (!route) return res.status(400).json({ error: "Bus route is required" });

    try {
        // 1️⃣ Get vehicles on this route
        const vehiclesUrl = `https://www.ctabustracker.com/bustime/api/v3/getvehicles?key=${CTA_BUS_KEY}&rt=${route}&format=json`;
        const vehiclesRes = await axios.get(vehiclesUrl);
        const vehicles = vehiclesRes.data["bustime-response"].vehicle || [];


        res.json({ route, vehicles });
    } catch (err) {
        console.error("Error fetching bus data:", err.message);
        res.status(500).json({ error: "Failed to fetch bus info" });
    }
});

// Get detailed CTA service alerts
app.get("/api/alerts", async (req, res) => {
    const { routeid, activeonly, planned, accessibility } = req.query;

    // Base URL for CTA Detailed Alerts API
    let url = `https://www.transitchicago.com/api/1.0/alerts.aspx?outputType=JSON`;

    // Add optional query params
    if (routeid) url += `&routeid=${encodeURIComponent(routeid)}`;
    if (activeonly) url += `&activeonly=${activeonly}`;
    if (planned) url += `&planned=${planned}`;
    if (accessibility) url += `&accessibility=${accessibility}`;

    try {
        const response = await axios.get(url);
        const data = response.data?.CTAAlerts;

        if (!data) {
            return res.status(500).json({ error: "Unexpected CTA API response" });
        }

        // Normalize to a clean, frontend-friendly format
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



app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
