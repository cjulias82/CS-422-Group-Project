import dotenv from "dotenv";
dotenv.config();

import express from "express";
import axios from "axios";
import cors from "cors";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
app.use(cors()); // Allow cross-origin requests

// Serve frontend files (track.html, track.css, track.js)
app.use(express.static(path.join(__dirname, "../frontend")));

// Set environment variables
const PORT = process.env.PORT || 5000;
const CTA_TRAIN_KEY = process.env.CTA_TRAIN_KEY;
const CTA_BUS_KEY = process.env.CTA_BUS_KEY;
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ---------- Helper Functions ----------

// Function to fetch data from the CTA API
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

// Basic health check route
app.get("/", (req, res) => res.send("CTA Ventra API is running..."));

// ---------- Google Maps API Integration ----------

// Route to fetch Google Maps API key (for development purposes)
app.get("/api/google-key", (req, res) => {
    if (process.env.NODE_ENV === "production") {
        return res.status(403).json({ error: "Google Maps key not available in production" });
    }
    res.json({ key: GOOGLE_MAPS_API_KEY });
});

// ---------- CTA Routes ----------

// Train data route
app.get("/api/trains/:route", (req, res) => {
    const route = req.params.route;
    const url = `https://lapi.transitchicago.com/api/1.0/ttpositions.aspx?key=${CTA_TRAIN_KEY}&rt=${route}&outputType=JSON`;
    fetchCTAData(url, res, "train");
});

// Bus data route
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

// ---------- Nearby Stops (Google Places API) ----------

app.get("/api/nearby", async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

    try {
        const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
        const response = await axios.get(url, {
            params: {
                location: `${lat},${lng}`,
                radius: 1000,  // Meters
                keyword: "transit_station",  // You can adjust the keyword to be more specific
                key: GOOGLE_MAPS_API_KEY,
            },
        });
        // Simplify results
        const results = response.data.results.map(place => ({
            name: place.name,
            location: place.geometry.location,
            types: place.types,
            address: place.vicinity,
        }));

        res.json({ count: results.length, results });
    } catch (error) {
        console.error("Error fetching nearby transit stations:", error.message);
        res.status(500).json({ error: "Failed to fetch nearby locations" });
    }
});

// ---------- Nearby Stops + Live Vehicles (Google Places + CTA) ----------
app.get("/api/tracknearby", async (req, res) => {
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: "Missing lat/lng" });

    try {
        // Fetch nearby stations from Google Places
        const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
        const placesRes = await axios.get(placesUrl, {
            params: {
                location: `${lat},${lng}`,
                radius: 1200, // meters
                keyword: "bus stop OR train station OR subway station",
                key: GOOGLE_MAPS_API_KEY,
            },
        });

        const stations = (placesRes.data.results || []).map((place) => ({
            name: place.name,
            location: place.geometry.location,
            types: place.types,
            address: place.vicinity,
            source: "Google Places",
        }));

        // Fetch live bus data from CTA API
        const busUrl = `https://www.ctabustracker.com/bustime/api/v3/getvehicles?key=${CTA_BUS_KEY}&format=json`;
        const busRes = await axios.get(busUrl);
        const buses = (busRes.data["bustime-response"]?.vehicle || []).map((v) => ({
            id: v.vid,
            route: v.rt,
            lat: parseFloat(v.lat),
            lng: parseFloat(v.lon),
            heading: v.hdg,
            destination: v.des,
            delayed: v.dly === true,
            source: "CTA Bus",
        }));

        // Fetch live train data from CTA API
        const trainUrl = `https://lapi.transitchicago.com/api/1.0/ttpositions.aspx?key=${CTA_TRAIN_KEY}&outputType=JSON`;
        const trainRes = await axios.get(trainUrl);
        const trainsData = trainRes.data?.ctatt?.route || [];
        const trains = trainsData.flatMap((route) =>
            (route.train || []).map((t) => ({
                id: t.rn,
                route: route.rt,
                lat: parseFloat(t.lat),
                lng: parseFloat(t.lon),
                heading: t.heading,
                destination: t.destNm,
                delayed: t.isDly === "1",
                source: "CTA Train",
            }))
        );

        // Combine all results and filter nearby (within ~1km)
        function distance(lat1, lon1, lat2, lon2) {
            const R = 6371; // km
            const dLat = (lat2 - lat1) * (Math.PI / 180);
            const dLon = (lon2 - lon1) * (Math.PI / 180);
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * (Math.PI / 180)) *
                Math.cos(lat2 * (Math.PI / 180)) *
                Math.sin(dLon / 2) *
                Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c; // km
        }

        const nearbyBuses = buses.filter(
            (b) => distance(lat, lng, b.lat, b.lng) <= 1.2
        );
        const nearbyTrains = trains.filter(
            (t) => distance(lat, lng, t.lat, t.lng) <= 1.5
        );

        res.json({
            center: { lat: parseFloat(lat), lng: parseFloat(lng) },
            stations: stations,
            buses: nearbyBuses,
            trains: nearbyTrains,
            counts: {
                stations: stations.length,
                buses: nearbyBuses.length,
                trains: nearbyTrains.length,
            },
        });
    } catch (error) {
        console.error("Error fetching nearby data:", error.message);
        res.status(500).json({ error: "Failed to fetch nearby transit data" });
    }
});

// ---------- Transit Directions (Google Directions API) ----------
app.get("/api/routes", async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to)
        return res.status(400).json({ error: "Missing origin or destination" });

    try {
        const url = `https://maps.googleapis.com/maps/api/directions/json`;
        const response = await axios.get(url, {
            params: {
                origin: from,
                destination: to,
                mode: "transit",
                alternatives: true,
                key: GOOGLE_MAPS_API_KEY,
            },
        });

        const data = response.data;
        if (data.status !== "OK") {
            console.error("Google Directions API error:", data.status, data.error_message);
            return res.status(500).json({ error: data.error_message || data.status });
        }

        const routes = data.routes.map((r) => {
            const leg = r.legs[0];

            const steps = leg.steps.map((s) => {
                const mode = s.travel_mode.toUpperCase();

                // 🟢 Handle walking
                if (mode === "WALKING") {
                    return {
                        type: "walking",
                        instructions: s.html_instructions || "Walk",
                        distance: s.distance?.text || "",
                        duration: s.duration?.text || "",
                    };
                }

                // 🟢 Handle transit (bus/train/subway)
                if (mode === "TRANSIT") {
                    const t = s.transit_details;
                    const vehicleType = t.line.vehicle.type.toUpperCase();
                    const isTrain = ["SUBWAY", "HEAVY_RAIL", "TRAM", "RAIL"].includes(vehicleType);

                    return {
                        type: isTrain ? "train" : "bus",
                        routeName: t.line.short_name || t.line.name || "",
                        headsign: t.headsign || "",
                        departureStop: t.departure_stop.name,
                        arrivalStop: t.arrival_stop.name,
                        numStops: t.num_stops || 0,
                        departureTime: t.departure_time?.text || "",
                        arrivalTime: t.arrival_time?.text || "",
                        distance: s.distance?.text || "",
                        duration: s.duration?.text || "",
                        instructions: s.html_instructions || "",
                        color: t.line.color || (isTrain ? "#1565C0" : "#555"),
                        agency: t.line.agencies?.[0]?.name || "CTA",
                    };
                }

                // 🟡 Default fallback
                return {
                    type: "other",
                    instructions: s.html_instructions || "Continue",
                    distance: s.distance?.text || "",
                    duration: s.duration?.text || "",
                };
            });

            return {
                duration: leg.duration.text,
                distance: leg.distance.text,
                arrival: leg.arrival_time?.text || "",
                departure: leg.departure_time?.text || "",
                startAddress: leg.start_address,
                endAddress: leg.end_address,
                steps,
            };
        });

        res.json({ routes });
    } catch (err) {
        console.error("Error fetching routes:", err.message);
        res.status(500).json({ error: "Failed to fetch transit routes" });
    }
});

// Serve the front-end application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/track', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'track.html'));
});

// ---------- Start Server ----------
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});