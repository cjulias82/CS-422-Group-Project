let map;
let fromMarker = null;
let destinationMarker = null;

let directionsService;
let directionsRenderer;

// ------------------------
// USE FIREBASE BACKEND
// ------------------------
const BACKEND_URL = window.location.hostname.includes("localhost")
    ? "http://localhost:5000"
    : "https://api-dt26u5phza-uc.a.run.app";

// ---------- Load Google Maps ----------
async function loadGoogleMaps() {
    const res = await fetch(`${BACKEND_URL}/google-key`);
    const data = await res.json();
    if (!data.key) return console.error("Google Maps API key not available.");

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${data.key}&callback=initMap&_=${Date.now()}`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

window.initMap = function () {
    if (!navigator.geolocation) {
        alert("Geolocation not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition((pos) => {
        const { latitude, longitude } = pos.coords;
        map = new google.maps.Map(document.getElementById("map"), {
            center: { lat: latitude, lng: longitude },
            zoom: 14,
        });
        new google.maps.Marker({
            position: { lat: latitude, lng: longitude },
            map,
            title: "Your Location",
        });
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
        preserveViewport: false,
    });
};

// ---------- Show Transit Routes ----------
async function showTransitRoutes(fromValue, toValue) {
    const routeList = document.getElementById("routeList");
    routeList.innerHTML = "<li>Loading routes...</li>";

    const res = await fetch(
        `${BACKEND_URL}/routes?from=${encodeURIComponent(fromValue)}&to=${encodeURIComponent(toValue)}`
    );
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
        routeList.innerHTML = "<li>No routes found.</li>";
        return;
    }

    routeList.innerHTML = "";
    const saved = JSON.parse(localStorage.getItem("savedRoutes") || "[]");

    data.routes.forEach((route, index) => {
        const item = document.createElement("li");
        item.classList.add("route-item");

        const name = `${route.steps[0]?.routeName || "Route"} (${route.duration})`;
        const isSaved = saved.some(
            (r) => r.name === name && r.from === fromValue && r.to === toValue
        );
        const starIcon = isSaved ? "icons/star.png" : "icons/favorite.png";

        // Deep clone the route steps to include textual directions
        const detailedSteps = route.steps.map((s) => ({
            type: s.type,
            routeName: s.routeName,
            headsign: s.headsign,
            departureTime: s.departureTime,
            arrivalTime: s.arrivalTime,
            duration: s.duration,
            distance: s.distance,
            numStops: s.numStops,
            instructions: s.instructions || s.html_instructions || "",
        }));

        const stepsHTML = route.steps
            .filter(s => s.type === "bus" || s.type === "train")
            .map((s) => {
                let iconUrl = s.type === "train" ? "icons/train.png" : "icons/bus.png";
                const iconImg = `<img src="${iconUrl}" class="route-icon" alt="${s.type}" />`;

                return `
            <div class="route-step">
                ${iconImg}
                <span>${s.departureTime || ""} → ${s.arrivalTime || ""}</span>
                <span class="route-chip ${s.type}">${s.routeName}</span>
            </div>`;
            })
            .join("");

        item.innerHTML = `
            <div class="route-summary">
                <button class="fav-btn" title="Save to Favorites">
                    <img src="${starIcon}" class="fav-icon" alt="Add to favorites" />
                </button>
                <strong>${route.duration}</strong>
                <div>${stepsHTML}</div>
            </div>
            <div class="directions-dropdown" style="display:none;"></div>
        `;

        // --- Click to toggle dropdown with directions ---
        item.querySelector(".route-summary").addEventListener("click", async (e) => {
            if (e.target.closest(".fav-btn")) return; // ignore star clicks

            const dropdown = item.querySelector(".directions-dropdown");
            const isOpen = dropdown.style.display === "block";

            // Close all other dropdowns first
            document.querySelectorAll(".directions-dropdown").forEach(el => (el.style.display = "none"));
            document.querySelectorAll(".route-item").forEach(el => el.classList.remove("active"));

            if (isOpen) {
                dropdown.style.display = "none";
                item.classList.remove("active");
                return;
            }

            item.classList.add("active");
            dropdown.style.display = "block";

            if (dropdown.dataset.loaded !== "true") {
                dropdown.innerHTML = "<p>Loading directions...</p>";
                await drawRouteOnMap(fromValue, toValue, index, dropdown);
                dropdown.dataset.loaded = "true";
            }
        });

        // --- Star favorite toggle ---
        const favBtn = item.querySelector(".fav-btn");
        favBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const starImg = favBtn.querySelector(".fav-icon");
            const savedRoutes = JSON.parse(localStorage.getItem("savedRoutes") || "[]");

            const alreadySaved = savedRoutes.some(
                (r) => r.name === name && r.from === fromValue && r.to === toValue
            );

            if (alreadySaved) {
                const updated = savedRoutes.filter(
                    (r) => !(r.name === name && r.from === fromValue && r.to === toValue)
                );
                localStorage.setItem("savedRoutes", JSON.stringify(updated));
                starImg.src = "icons/favorite.png";
            } else {
                savedRoutes.push({
                    name,
                    from: fromValue,
                    to: toValue,
                    duration: route.duration,
                    routeIndex: index,
                    steps: route.steps.map((s) => ({
                        type: s.type,
                        routeName: s.routeName || "",
                        departureStop: s.departureStop || "",
                        arrivalStop: s.arrivalStop || "",
                        numStops: s.numStops || "",
                        departureTime: s.departureTime || "",
                        arrivalTime: s.arrivalTime || "",
                        distance: s.distance || "",
                        durationStep: s.duration || "",
                        instructions: s.instructions || "",
                        color: s.color || "#555",
                    })),
                    timestamp: Date.now(),
                });
                localStorage.setItem("savedRoutes", JSON.stringify(savedRoutes));
                starImg.src = "icons/star.png";
            }

            populateFavorites();
        });

        routeList.appendChild(item);
    });
}

async function drawRouteOnMap(fromValue, toValue, routeIndex = 0, dropdown = null) {
    if (!directionsService || !directionsRenderer) {
        console.error("Directions services not initialized.");
        return;
    }

    directionsRenderer.setMap(map);

    const request = {
        origin: fromValue,
        destination: toValue,
        travelMode: google.maps.TravelMode.TRANSIT,
        provideRouteAlternatives: true,
    };

    directionsService.route(request, (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK) {
            console.error("Directions request failed:", status);
            if (dropdown) dropdown.innerHTML = "<p>Unable to load directions.</p>";
            return;
        }

        const idx = Math.min(routeIndex, result.routes.length - 1);
        const singleResult = { ...result, routes: [result.routes[idx]] };
        directionsRenderer.setDirections(singleResult);

        if (singleResult.routes[0].bounds) {
            map.fitBounds(singleResult.routes[0].bounds);
        }

        if (!dropdown) return;

        const leg = singleResult.routes[0].legs[0];
        dropdown.innerHTML = `<h4>Directions</h4>`;

        leg.steps.forEach((step) => {
            let icon = "icons/walking.png";
            if (step.travel_mode === "TRANSIT") {
                const vehicleType = step.transit?.line?.vehicle?.type?.toUpperCase() || "";
                if (vehicleType.includes("BUS")) {
                    icon = "icons/bus.png";
                } else if (
                    vehicleType.includes("TRAIN") ||
                    vehicleType.includes("RAIL") ||
                    vehicleType.includes("SUBWAY")
                ) {
                    icon = "icons/train.png";
                }
            }

            const lineName = step.transit?.line?.short_name || step.transit?.line?.name || "";
            let lineColor = "#555";
            const lineColors = {
                "Red Line": "#C60C30",
                "Blue Line": "#00A1DE",
                "Brown Line": "#62361B",
                "Green Line": "#009B3A",
                "Orange Line": "#F9461C",
                "Pink Line": "#E27EA6",
                "Purple Line": "#522398",
                "Yellow Line": "#F9E300",
            };
            for (const [key, val] of Object.entries(lineColors)) {
                if (lineName.toLowerCase().includes(key.toLowerCase())) {
                    lineColor = val;
                    break;
                }
            }

            const stepDiv = document.createElement("div");
            stepDiv.classList.add("direction-step");
            stepDiv.innerHTML = `
                <img src="${icon}" class="route-icon" />
                <div>
                    <strong>${step.instructions || step.html_instructions || "Travel"}</strong><br>
                    <small>${step.duration?.text || ""} ${step.distance?.text ? "• " + step.distance.text : ""}</small>
                    ${step.travel_mode === "TRANSIT" && lineName ? `<div class="cta-line-chip" style="background:${lineColor};color:${lineColor === '#F9E300' ? '#000' : '#fff'};">${lineName}</div>` : ""}
                </div>
            `;
            dropdown.appendChild(stepDiv);
        });
    });
}

// ---------- Favorites Panel Integration ----------
function populateFavorites() {
    const menu = document.getElementById("favoritesMenu");
    const toggle = document.getElementById("favoritesToggle");

    const saved = JSON.parse(localStorage.getItem("savedRoutes") || "[]");
    menu.innerHTML = "";

    if (saved.length === 0) {
        toggle.textContent = "No favorites";
        return;
    }

    saved.forEach((r, i) => {
        const item = document.createElement("div");
        item.classList.add("dropdown-item");
        item.innerHTML = `
      <span class="fav-name">${r.name || `Route (${r.duration})`}</span>
      <div class="dropdown-actions">
        <span class="delete">×</span>
      </div>
    `;

        item.querySelector(".fav-name").addEventListener("click", async () => {
            toggle.textContent = r.name;
            menu.style.display = "none";

            await showTransitRoutes(r.from, r.to);
            await drawRouteOnMap(r.from, r.to, r.routeIndex ?? 0);
            showFavoriteRoutePanel(r);
        });

        item.querySelector(".delete").addEventListener("click", (e) => {
            e.stopPropagation();
            if (confirm(`Delete '${r.name}' from favorites?`)) {
                saved.splice(i, 1);
                localStorage.setItem("savedRoutes", JSON.stringify(saved));
                populateFavorites();
            }
        });

        menu.appendChild(item);
    });
}

// ---------- Side Panel ----------
document.addEventListener("DOMContentLoaded", () => {
    populateFavorites();

    const openPanelBtn = document.getElementById("openPanel");
    const closePanelBtn = document.getElementById("closePanel");
    const sidePanel = document.getElementById("sidePanel");
    const planBtn = document.getElementById("planBtn");
    const fromInput = document.getElementById("fromInput");
    const toInput = document.getElementById("toInput");

    openPanelBtn.addEventListener("click", () => {
        sidePanel.classList.add("active");
        const dest = document.getElementById("destination").value;
        if (dest) toInput.value = dest;
    });

    closePanelBtn.addEventListener("click", () => sidePanel.classList.remove("active"));

    planBtn.addEventListener("click", async () => {
        const fromValue = fromInput.value.trim();
        const toValue = toInput.value.trim();
        if (!toValue) return alert("Please enter a destination.");

        const res = await fetch(`${BACKEND_URL}/google-key`);
        const data = await res.json();
        const key = data.key;
        const bounds = new google.maps.LatLngBounds();

        async function geocode(address, color) {
            const geoRes = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`
            );
            const geoData = await geoRes.json();
            if (geoData.status === "OK" && geoData.results.length > 0) {
                const location = geoData.results[0].geometry.location;
                const marker = new google.maps.Marker({
                    position: location,
                    map,
                    icon: { url: `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png` },
                });
                bounds.extend(location);
                return marker;
            }
        }

        if (fromMarker) fromMarker.setMap(null);
        if (destinationMarker) destinationMarker.setMap(null);

        if (!fromValue) {
            navigator.geolocation.getCurrentPosition(async (pos) => {
                const { latitude, longitude } = pos.coords;
                fromMarker = new google.maps.Marker({
                    position: { lat: latitude, lng: longitude },
                    map,
                    icon: { url: "http://maps.google.com/mapfiles/ms/icons/blue-dot.png" },
                });
                bounds.extend({ lat: latitude, lng: longitude });

                await showTransitRoutes(`${latitude},${longitude}`, toValue);
            });
        } else {
            fromMarker = await geocode(fromValue, "blue");
            await showTransitRoutes(fromValue, toValue);
        }

        destinationMarker = await geocode(toValue, "red");
        map.fitBounds(bounds);
        await showTransitRoutes(fromValue || "current location", toValue);

        if (fromMarker) {
            const pos = fromMarker.getPosition();
            await showNearbyRoutes(pos.lat(), pos.lng());
        }
    });
});

loadGoogleMaps();
