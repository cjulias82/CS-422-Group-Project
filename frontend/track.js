let map;
let userMarker;
let autoRefreshInterval;

// Hashmaps for fast lookup
let vehicleMarkers = {};   // id => marker
let stationMarkers = {};   // id => marker
let transitListItems = {};

const defaultLocation = { lat: 41.87199689919318, lng: -87.64795732274237 };
const defaultZoom = 15;
const API_BASE = "https://api-dt26u5phza-uc.a.run.app";

// CTA Stop IDs
const ctaStops = {
    "Clark/Lake": 30112,
    "State/Lake": 30121,
    "Lake/Red": 30003,
    "Roosevelt": 40350,
    // ... add all relevant CTA station names
};

/*/ ---------- Utility: Determine Station Icon ----------
function getStationIcon(station) {
    // Use the type property directly
    if (!station || !station.type) return "bus.png";  // fallback
    return station.type === "train" ? "train.png" : "bus.png";
}

// ---------- Utility: Determine Vehicle Icon ----------
function getVehicleIcon(vehicle) {
    // Use the type property directly
    if (!vehicle || !vehicle.type) return "bus.png";  // fallback
    return vehicle.type === "train" ? "train.png" : "bus.png";
}
*/

// ---------- Check if marker is in viewport ----------
function isMarkerInView(marker) {
    if (!marker || !map) return false;
    const bounds = map.getBounds();
    if (!bounds) return false;
    return bounds.contains(marker.getPosition());
}

// ---------- Load Google Maps ----------
async function loadGoogleMaps() {
    try {
        const res = await fetch(`${API_BASE}/google-key`);
        const data = await res.json();
        if (!data.key) return console.error("Google Maps API key not available.");

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${data.key}&callback=initMap`;
        script.async = true;
        script.defer = true;
        window.initMap = initMap;
        document.head.appendChild(script);
    } catch (err) {
        console.error("Error loading Google Maps:", err);
    }
}

// ---------- Initialize Map ----------
function initMap() {
    const options = { zoom: defaultZoom, center: defaultLocation };
    map = new google.maps.Map(document.getElementById("map"), options);

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => setupMap(pos.coords.latitude, pos.coords.longitude),
            () => setupMap(defaultLocation.lat, defaultLocation.lng)
        );
    } else {
        setupMap(defaultLocation.lat, defaultLocation.lng);
    }

    if (navigator.geolocation && navigator.geolocation.watchPosition) {
        navigator.geolocation.watchPosition(pos => {
            const { latitude, longitude } = pos.coords;
            if (userMarker) userMarker.setPosition({ lat: latitude, lng: longitude });
            updateLiveETA(latitude, longitude);
        });
    }
}

// ---------- Setup Map ----------
function setupMap(lat, lng) {
    map.setCenter({ lat, lng });

    if (!userMarker) {
        userMarker = new google.maps.Marker({
            position: { lat, lng },
            map,
            title: "Your Location",
            icon: {
                url: "icons/walking.png",
                scaledSize: new google.maps.Size(25, 25)
            }
        });
    } else {
        userMarker.setPosition({ lat, lng });
    }

    fetchNearbyTransit(lat, lng);
    startAutoRefresh();
}

// ---------- Fetch Nearby Transit ----------
function fetchNearbyTransit(lat, lng) {
    fetch(`${API_BASE}/tracknearby?lat=${lat}&lng=${lng}`)
        .then(res => res.json())
        .then(data => displayTransitInfo(data, lat, lng))
        .catch(err => {
            console.error("Error fetching transit:", err);
            displayTransitInfo({ stations: [], buses: [], trains: [] }, lat, lng);
        });
}

// ---------- Display Transit Info ----------
function displayTransitInfo(data, userLat, userLng) {
    const transitList = document.getElementById("transit-list");
    transitList.innerHTML = "";
    transitListItems = {};

    const { stations = [], buses = [], trains = [] } = data;

    // --- Stations ---
    stations.forEach(place => {
        const id = `station-${place.name}`;
        const type = ctaStops[place.name] ? "train" : "bus";
        const stationData = {
            name: place.name,
            type: type,
            address: place.address || "",
            location: place.location
        };

        const eta = calculateETA(stationData.location, userLat, userLng);

        const li = document.createElement("li");
        /* li.innerHTML = `<img src="icons/${getStationIcon(stationData)}" style="width:16px;margin-right:6px;vertical-align:middle;">
                        <strong>${stationData.name}</strong> (${eta} min away)<br/>
                        <small>${stationData.address}</small>`;
        li.addEventListener("click", () => { map.panTo(stationData.location); map.setZoom(17); }); */

        li.innerHTML = `<strong>${stationData.name}</strong> (${eta} min away)<br/>
                        <small>${stationData.address}</small>`;
        li.addEventListener("click", () => { map.panTo(stationData.location); map.setZoom(17); });

        transitListItems[id] = { li, type: "station", data: stationData };

        if (!stationMarkers[id]) {
            const marker = new google.maps.Marker({
                position: stationData.location,
                map,
                title: stationData.name,
                /* icon: { url: `icons/${getStationIcon(stationData)}`, scaledSize: new google.maps.Size(25, 25) } */
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `<b>${stationData.name}</b><br>${stationData.address}<br>ETA: ${eta} min`
            });
            marker.infoWindow = infoWindow;

            marker.addListener("click", () => {
                infoWindow.open(map, marker);
                const item = transitListItems[id];
                if (item && item.li) {
                    item.li.scrollIntoView({ behavior: "smooth", block: "center" });
                    item.li.style.background = "#f0f8ff";
                    setTimeout(() => { item.li.style.background = ""; }, 2000);
                }
                if (stationData.type === "train") {
                    fetchCTAStopArrivals(stationData.name, item.li);
                }
            });

            stationMarkers[id] = marker;
        } else {
            const marker = stationMarkers[id];
            /* marker.setPosition(stationData.location);
            marker.setIcon({ url: `icons/${getStationIcon(stationData)}`, scaledSize: new google.maps.Size(25, 25) });
            marker.infoWindow.setContent(`<b>${stationData.name}</b><br>${stationData.address}<br>ETA: ${eta} min`); */
            marker.infoWindow.setContent(`<b>${stationData.name}</b><br>${stationData.address}<br>ETA: ${eta} min`);
        }

        transitList.appendChild(li);
    });

    // --- Vehicles ---
    [...buses, ...trains].forEach(vehicle => {
        vehicle.type = vehicle.type || (vehicle.route ? "train" : "bus");
        createOrUpdateVehicleMarker(vehicle, userLat, userLng);
    });
}

// ---------- Create or Update Vehicle Marker ----------
function createOrUpdateVehicleMarker(vehicle, userLat, userLng) {
    const id = `${vehicle.type}-${vehicle.id}`;
    const eta = calculateETA(vehicle, userLat, userLng);

    if (!transitListItems[id]) {
        const li = document.createElement("li");
        /* li.innerHTML = `<img src="icons/${getVehicleIcon(vehicle)}" style="width:16px;margin-right:6px;vertical-align:middle;">
                        <strong>${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route || ''}</strong>
                        (${eta} min ETA)<br/>
                        <small>Destination: ${vehicle.destination || 'En route'}</small>`; */
        li.innerHTML = `<strong>${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route || ""}</strong>
                        (${eta} min ETA)<br/>
                        <small>Destination: ${vehicle.destination || "En route"}</small>`;

        transitListItems[id] = { li, type: "vehicle", vehicle };
        document.getElementById("transit-list").appendChild(li);
        // li.addEventListener("click", () => map.panTo({ lat: vehicle.lat, lng: vehicle.lng }));
        li.addEventListener("click", () => {
            map.panTo({ lat: vehicle.lat, lng: vehicle.lng });
            map.setZoom(16);
        });
    } else {
        const item = transitListItems[id];
        item.vehicle = vehicle;
        /* item.li.innerHTML = `<img src="icons/${getVehicleIcon(vehicle)}" style="width:16px;margin-right:6px;vertical-align:middle;">
                             <strong>${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route || ''}</strong>
                             (${eta} min ETA)<br/>
                             <small>Destination: ${vehicle.destination || 'En route'}</small>`; */
        item.li.innerHTML = `<strong>${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route || ""}</strong>
                            (${eta} min ETA)<br/>
                            <small>Destination: ${vehicle.destination || "En route"}</small>`;
    }

    if (vehicleMarkers[id]) {
        vehicleMarkers[id].setPosition({ lat: vehicle.lat, lng: vehicle.lng });
        vehicleMarkers[id].vehicle = vehicle;
        updateInfoWindow(vehicleMarkers[id], vehicle, eta);
        return;
    }

    const marker = new google.maps.Marker({
        position: { lat: vehicle.lat, lng: vehicle.lng },
        map,
        title: `${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route} → ${vehicle.destination}`,
        //icon: { url: `icons/${getVehicleIcon(vehicle)}`, scaledSize: new google.maps.Size(25, 25) }
    });
    marker.id = id;
    marker.vehicle = vehicle;

    const infoWindow = new google.maps.InfoWindow();
    marker.infoWindow = infoWindow;
    updateInfoWindow(marker, vehicle, eta);

    marker.addListener("click", () => {
        infoWindow.open(map, marker);
        const item = transitListItems[id];
        if (item && item.li) {
            item.li.scrollIntoView({ behavior: "smooth", block: "center" });
            item.li.style.background = "#f0f8ff";
            setTimeout(() => { item.li.style.background = ""; }, 2000);
        }
    });

    vehicleMarkers[id] = marker;
}

// ---------- Update InfoWindow ----------
function updateInfoWindow(marker, vehicle, eta) {
    marker.infoWindow.setContent(
        `<b>${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route || ""}</b><br>
         Destination: ${vehicle.destination || "En route"}<br>
         ETA: ${eta} min`
    );
}

// ---------- CTA next arrivals ----------
async function fetchCTAStopArrivals(stationName, liElement) {
    const stpid = ctaStops[stationName];
    if (!stpid) return;

    try {
        const res = await fetch(`${API_BASE}/cta-arrivals?stpid=${stpid}`);
        const data = await res.json();

        const arrivals = data.ctatt?.eta || [];
        if (arrivals.length === 0) return;

        const nextArrivals = arrivals
            .slice(0, 3)
            //.map(a => `${a.rt} → ${a.dest} in ${a.arrT ? Math.max(Math.round((new Date(a.arrT) - new Date())/60000),0) : "?"} min`)
            .map(a => {
                const minutes = a.arrT ? Math.max(Math.round((new Date(a.arrT) - new Date()) / 60000), 0) : "?";
                return `${a.rt} → ${a.dest} in ${minutes} min`;})
            .join("<br>");

        liElement.innerHTML += `<br><small>Next arrivals:<br>${nextArrivals}</small>`;
    } catch (err) {
        console.error("CTA arrivals fetch error:", err);
    }
}

// ---------- Calculate ETA ----------
function calculateETA(target, userLat, userLng) {
    if (!target.lat || !target.lng || !userLat || !userLng) return "?";
    const R = 6371;
    const dLat = ((userLat - target.lat) * Math.PI) / 180;
    const dLon = ((userLng - target.lng) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos((target.lat * Math.PI) / 180) *
        Math.cos((userLat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = R * c;
    const speedKmh = target.type === "bus" ? 20 : 25;
    return Math.round((distanceKm / speedKmh) * 60);
}

// ---------- Update Live ETA ----------
function updateLiveETA(userLat, userLng) {
    // Vehicles
    for (const id in vehicleMarkers) {
        const marker = vehicleMarkers[id];
        const vehicle = marker.vehicle;
        const eta = calculateETA(vehicle, userLat, userLng);
        const item = transitListItems[id];
        /* if (item && item.li) {
            item.li.innerHTML = `<img src="icons/${getVehicleIcon(vehicle)}" style="width:16px;margin-right:6px;vertical-align:middle;">
                                 <strong>${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route || ""}</strong>
                                 (${eta} min ETA)<br>
                                 <small>Destination: ${vehicle.destination || "En route"}</small>`;
        } */
        if (item && item.li) {
            item.li.innerHTML = `<strong>${vehicle.type === "bus" ? "Bus" : "Train"} ${vehicle.route || ""}</strong>
                                (${eta} min ETA)<br>
                                <small>Destination: ${vehicle.destination || "En route"}</small>`;
        }
        updateInfoWindow(marker, vehicle, eta);
    }

    // Stations
    for (const id in stationMarkers) {
        const marker = stationMarkers[id];
        const item = transitListItems[id];
        if (!item || !item.data) continue;

        const stationData = item.data;
        const eta = calculateETA(stationData.location, userLat, userLng);
        // const icon = getStationIcon(stationData);

        // Sidebar
        if (item.li) {
            /* item.li.innerHTML = `<img src="icons/${icon}" style="width:16px;margin-right:6px;vertical-align:middle;">
                                 <strong>${stationData.name}</strong> (${eta} min away)<br/>
                                 <small>${stationData.address}</small>`; */
            item.li.innerHTML = `<strong>${stationData.name}</strong> (${eta} min away)<br/>
                                <small>${stationData.address}</small>`;
        }

        // Marker
        // marker.setIcon({ url: `icons/${icon}`, scaledSize: new google.maps.Size(25, 25) });
        marker.infoWindow.setContent(
            `<b>${stationData.name}</b><br>${stationData.address}<br>ETA: ${eta} min<br>
             <a href="index.html?destination=${encodeURIComponent(stationData.name)}">Route Here</a>`
        );
    }
}

// ---------- Auto-refresh ----------
function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        if (!userMarker) return;
        const pos = userMarker.getPosition().toJSON();

        fetchNearbyTransit(pos.lat, pos.lng);
        updateLiveETA(pos.lat, pos.lng);

        for (const id in transitListItems) {
            const item = transitListItems[id];
            if (item.type === "station" && item.data.type === "train") {
                const marker = stationMarkers[id];
                if (isMarkerInView(marker)) {
                    const eta = calculateETA(item.data.location, pos.lat, pos.lng);
                    item.li.innerHTML = // <img src="icons/${getStationIcon(item.data)}" style="width:16px;margin-right:6px;vertical-align:middle;">
                                         `<strong>${item.data.name}</strong> (${eta} min away)<br/>
                                         <small>${item.data.address}</small>`;
                    fetchCTAStopArrivals(item.data.name, item.li);
                }
            }
        }
    }, 30000);
}

// ---------- Load Google Maps ----------
loadGoogleMaps();