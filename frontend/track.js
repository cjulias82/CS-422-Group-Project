let map;
let userMarker;
let liveMarkers = []; // store live bus/train/station markers
let autoRefreshInterval;

const defaultLocation = { lat: 41.8786, lng: -87.6405 }; // Chicago Union Station fallback
const defaultZoom = 13;

const API_BASE = "https://api-dt26u5phza-uc.a.run.app";

// ---------- Load Google Maps ----------
async function loadGoogleMaps() {
    const res = await fetch(`${API_BASE}/google-key`);
    const data = await res.json();
    if (!data.key) return console.error("Google Maps API key not available.");

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${data.key}&callback=initMap`;
    script.async = true;
    script.defer = true;
    window.initMap = initMap;
    document.head.appendChild(script);
}

// ---------- Initialize Map ----------
function initMap() {
    if (!navigator.geolocation) {
        alert("Geolocation not supported by your browser.");
        initDefaultMap();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        (pos) => {
            const { latitude, longitude } = pos.coords;
            map = new google.maps.Map(document.getElementById("map"), {
                center: { lat: latitude, lng: longitude },
                zoom: 14,
            });

            userMarker = new google.maps.Marker({
                position: { lat: latitude, lng: longitude },
                map,
                title: "Your Location",
                icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png",
            });

            // Fetch nearby stations + live vehicles
            fetchNearbyTransit(latitude, longitude);
            startAutoRefresh(latitude, longitude);
        },
        (err) => {
            console.warn("Geolocation error:", err);
            initDefaultMap();
        }
    );
}

// ---------- Fallback map if geolocation fails ----------
function initDefaultMap() {
    map = new google.maps.Map(document.getElementById("map"), {
        center: defaultLocation,
        zoom: defaultZoom,
    });

    new google.maps.Marker({
        position: defaultLocation,
        map,
        title: "Default Location: Chicago Union Station",
        icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png",
    });

    fetchNearbyTransit(defaultLocation.lat, defaultLocation.lng);
    startAutoRefresh(defaultLocation.lat, defaultLocation.lng);
}

/**
 * Fetch nearby stations + live CTA vehicles
 */
function fetchNearbyTransit(lat, lng) {
    const url = `${API_BASE}/tracknearby?lat=${lat}&lng=${lng}`;
    console.log("Requesting nearby transit:", url);

    fetch(url)
        .then((res) => res.json())
        .then((json) => displayTransitInfo(json))
        .catch((err) => {
            console.error("Error fetching transit data:", err);
            displayTransitInfo({ results: [] });
        });
}

/**
 * Display transit information (stations + live vehicles)
 */
function displayTransitInfo(data) {
    const transitList = document.getElementById("transit-list");
    transitList.innerHTML = "";

    if (!data) {
        transitList.innerHTML = "<li>No transit data available.</li>";
        return;
    }

    const { stations = [], buses = [], trains = [] } = data;

    if (stations.length === 0 && buses.length === 0 && trains.length === 0) {
        transitList.innerHTML = "<li>No nearby transit found.</li>";
        return;
    }

    // Clear old markers from map
    liveMarkers.forEach((m) => m.setMap(null));
    liveMarkers = [];

    // --- Google Places Results ---
    stations.forEach((place) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <img src="icons/walking.png" style="width:18px;margin-right:6px;vertical-align:middle;">
            <strong>${place.name}</strong><br/>
            <small>${place.address}</small>
        `;
        transitList.appendChild(li);

        const marker = new google.maps.Marker({
            position: place.location,
            map,
            title: place.name,
            icon: "http://maps.google.com/mapfiles/ms/icons/green-dot.png",
        });
        liveMarkers.push(marker);
    });

    // --- Live Buses ---
    buses.forEach((bus) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <img src="icons/bus.png" style="width:18px;margin-right:6px;vertical-align:middle;">
            <strong>Bus ${bus.route}</strong><br/>
            <small>${bus.destination || "En route"}</small>
        `;
        transitList.appendChild(li);

        const marker = new google.maps.Marker({
            position: { lat: bus.lat, lng: bus.lng },
            map,
            title: `Bus ${bus.route} → ${bus.destination}`,
            icon: "http://maps.google.com/mapfiles/ms/icons/orange-dot.png",
        });
        liveMarkers.push(marker);
    });

    // --- Live Trains ---
    trains.forEach((train) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <img src="icons/train.png" style="width:18px;margin-right:6px;vertical-align:middle;">
            <strong>${train.route} Line Train</strong><br/>
            <small>${train.destination || "In service"}</small>
        `;
        transitList.appendChild(li);

        const marker = new google.maps.Marker({
            position: { lat: train.lat, lng: train.lng },
            map,
            title: `${train.route} Line → ${train.destination}`,
            icon: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png",
        });
        liveMarkers.push(marker);
    });

    console.log(
        `Updated: ${stations.length} stations, ${buses.length} buses, ${trains.length} trains.`
    );
}

/**
 * Auto-refresh nearby transit every 30 seconds
 */
function startAutoRefresh(lat, lng) {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        console.log("Refreshing live transit data...");
        fetchNearbyTransit(lat, lng);
    }, 30000); // 30 seconds
}

loadGoogleMaps();