let map;
let fromMarker = null;
let destinationMarker = null;

let directionsService;
let directionsRenderer;

const API_BASE = "https://us-central1-looped-318cc.cloudfunctions.net/api";

// ---------- Load Google Maps ----------
async function loadGoogleMaps() {
    const res = await fetch(`${API_BASE}/google-key`);
    const data = await res.json();
    if (!data.key) return console.error("Google Maps API key not available.");

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${data.key}&callback=initMap`;
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

function clearDisplayedRoute() {
    if (directionsRenderer) {
        // Clears the current route polyline from the map
        directionsRenderer.setDirections({ routes: [] });
    }
}

// ---------- Show Transit Routes ----------
async function showTransitRoutes(fromValue, toValue) {
    const routeList = document.getElementById("routeList");
    routeList.innerHTML = "<li>Loading routes...</li>";

    const res = await fetch(
        `${API_BASE}/routes?from=${encodeURIComponent(fromValue)}&to=${encodeURIComponent(toValue)}`
    );
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
        routeList.innerHTML = "<li>No routes found.</li>";
        return;
    }

    routeList.innerHTML = "";
    const saved = JSON.parse(localStorage.getItem("savedRoutes") || "[]");

    // Load preferences once per call
    const prefs = JSON.parse(localStorage.getItem("preferences") || "{}");
    const showBus = prefs.bus !== false;   // default true
    const showTrain = prefs.train !== false; // default true

    data.routes.forEach((route, index) => {
        // ---------- 1) Decide if this ROUTE is allowed at all ----------
        const hasBus = route.steps.some((s) => s.type === "bus");
        const hasTrain = route.steps.some((s) => s.type === "train");

        let routeAllowed = true;

        if (showBus && !showTrain) {
            // Bus only
            routeAllowed = hasBus;
        } else if (!showBus && showTrain) {
            // Train only
            routeAllowed = hasTrain;
        } else if (!showBus && !showTrain) {
            // Neither selected => no routes allowed
            routeAllowed = false;
        } else {
            // Both selected => all routes allowed
            routeAllowed = true;
        }

        if (!routeAllowed) {
            // Skip this route entirely
            return;
        }

        // ---------- 2) Now filter out unwanted steps inside the route ----------
        route.steps = route.steps.filter((s) => {
            if (s.type === "bus" && !showBus) return false;
            if (s.type === "train" && !showTrain) return false;
            return true; // keep walking + allowed transit
        });

        // Safety check: if somehow nothing remains, skip it
        if (route.steps.length === 0) {
            return;
        }

        // ---------- 3) Build the UI item ----------
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
            .filter((s) => s.type === "bus" || s.type === "train")
            .map((s) => {
                const iconUrl = s.type === "train" ? "icons/train.png" : "icons/bus.png";
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
            document.querySelectorAll(".directions-dropdown").forEach((el) => (el.style.display = "none"));
            document.querySelectorAll(".route-item").forEach((el) => el.classList.remove("active"));

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

            const existingIndex = savedRoutes.findIndex(
                (r) => r.from === fromValue && r.to === toValue && r.routeIndex === index
            );

            if (existingIndex !== -1) {
                savedRoutes.splice(existingIndex, 1);
                localStorage.setItem("savedRoutes", JSON.stringify(savedRoutes));
                starImg.src = "icons/favorite.png";
                populateFavorites();
                return;
            }

            const defaultRouteName =
                route.steps?.[0]?.routeName
                    ? `${route.steps[0].routeName} (${route.duration})`
                    : `Route (${route.duration})`;

            const customName = prompt("Name this route:", defaultRouteName);
            if (!customName) return;

            const nameToSave = customName.trim();
            if (nameToSave.length === 0) return;

            savedRoutes.push({
                name: nameToSave,
                from: fromValue,
                to: toValue,
                duration: route.duration,
                routeIndex: index,
                steps: route.steps.map((s) => ({
                    type: s.type,
                    routeName: s.routeName || "",
                    routeId: s.routeId || s.routeName || "",
                    departureStop: s.departureStop || "",
                    arrivalStop: s.arrivalStop || "",
                    numStops: s.numStops || "",
                    departureTime: s.departureTime || "",
                    arrivalTime: s.arrivalTime || "",
                    distance: s.distance || "",
                    durationStep: s.duration || "",
                    instructions: s.instructions || "",
                    color: s.color || "#555",
                    lat: s.lat || null,
                    lng: s.lng || null
                })),
                timestamp: Date.now(),
            });

            localStorage.setItem("savedRoutes", JSON.stringify(savedRoutes));
            starImg.src = "icons/star.png";
            populateFavorites();
        });

        routeList.appendChild(item);
    });

    // If no routes survived the filtering, show a message
    if (!routeList.hasChildNodes()) {
        routeList.innerHTML = "<li>No routes match your preferences.</li>";
    }
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

        // --- Build per-route directions ---
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
            let lineColor = "#555"; // default gray
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

function drawSavedRouteOnMap(route) {
    if (!route.steps) return false;

    const coordSteps = route.steps.filter(s => s.lat && s.lng);

    if (coordSteps.length < 2) {
        return false; // not enough data to draw a line
    }

    const path = coordSteps.map(s => ({
        lat: parseFloat(s.lat),
        lng: parseFloat(s.lng)
    }));

    new google.maps.Polyline({
        map,
        path,
        strokeColor: "#2f3e9e",
        strokeOpacity: 0.9,
        strokeWeight: 4,
    });

    const bounds = new google.maps.LatLngBounds();
    path.forEach(p => bounds.extend(p));
    map.fitBounds(bounds);

    return true;
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

        // Click name to open route
        item.querySelector(".fav-name").addEventListener("click", async () => {
            clearDisplayedRoute();
            toggle.textContent = r.name;
            menu.style.display = "none";

            // First try drawing saved coordinates (so the map matches the saved bus)
            if (!drawSavedRouteOnMap(r)) {
                // fallback only if your saved data doesn't include coordinates yet
                await drawRouteOnMap(r.from, r.to, r.routeIndex ?? 0);
            }

            // Always show the saved steps in the panel
            showFavoriteRoutePanel(r);
        });

        // Delete
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

// Toggle dropdown open/close
document.getElementById("favoritesToggle")?.addEventListener("click", () => {
    const menu = document.getElementById("favoritesMenu");
    menu.style.display = menu.style.display === "block" ? "none" : "block";
});

// Preferences dropdown toggle
document.getElementById("preferencesToggle")?.addEventListener("click", () => {
    const menu = document.getElementById("preferencesMenu");
    menu.style.display = menu.style.display === "block" ? "none" : "block";
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
    const favoritesDropdown = document.querySelector(".favorites-dropdown .custom-dropdown");
    const preferencesDropdown = document.querySelector(".preferences-dropdown .custom-dropdown");

    // Close Favorites menu
    if (favoritesDropdown && !favoritesDropdown.contains(e.target)) {
        const favMenu = document.getElementById("favoritesMenu");
        if (favMenu) favMenu.style.display = "none";
    }

    // Close Preferences menu
    if (preferencesDropdown && !preferencesDropdown.contains(e.target)) {
        const prefMenu = document.getElementById("preferencesMenu");
        if (prefMenu) prefMenu.style.display = "none";
    }
});

// Delete selected favorite
document.getElementById("deleteFavoriteBtn")?.addEventListener("click", () => {
    const select = document.getElementById("favoritesSelect");
    const index = select.value;

    if (index === "") {
        alert("Please select a favorite to delete.");
        return;
    }

    const saved = JSON.parse(localStorage.getItem("savedRoutes") || "[]");
    const route = saved[index];

    if (!route) return;
    if (!confirm(`Delete '${route.name}' from favorites?`)) return;

    saved.splice(index, 1);
    localStorage.setItem("savedRoutes", JSON.stringify(saved));

    populateFavorites();
    select.value = "";
});

// When user selects a favorite route
document.getElementById("favoritesSelect")?.addEventListener("change", async (e) => {
    clearDisplayedRoute();
    const index = e.target.value;
    if (index === "") return;

    const saved = JSON.parse(localStorage.getItem("savedRoutes") || "[]");
    const route = saved[index];
    if (!route) return;

    // Draw on the map
    await drawRouteOnMap(route.from, route.to, route.routeIndex ?? 0);

    // --- Open the right-hand panel ---
    const panel = document.getElementById("routeDetailsPanel");
    const content = document.getElementById("routeDetailsContent");

    const stepsHTML = route.steps.map((s) => {
        let icon = "icons/walking.png";
        if (s.type === "train") icon = "icons/train.png";
        else if (s.type === "bus") icon = "icons/bus.png";

        const isWalking = s.type === "walk";
        const color = s.color || (isWalking ? "#999" : "#1565C0");
        const label = isWalking ? "Walk" : s.routeName || "Transit";

        const instructionText = s.instructions
            ? s.instructions
            : isWalking
                ? `Walk ${s.distance || ""} (${s.durationStep || s.duration || ""})`
                : `${s.departureStop || ""} → ${s.arrivalStop || ""}`;

        const detailText = [
            s.departureTime && s.arrivalTime ? `${s.departureTime} → ${s.arrivalTime}` : "",
            s.numStops ? `${s.numStops} stops` : "",
            s.distance && !isWalking ? `${s.distance}` : ""
        ].filter(Boolean).join(" • ");

        return `
        <div class="route-step">
            <img src="${icon}" class="route-icon" alt="${s.type}" />
            <span class="route-chip ${s.type}" style="background:${color}">${label}</span>
            <div class="step-text">
                <div>${instructionText}</div>
                ${detailText ? `<small>${detailText}</small>` : ""}
            </div>
        </div>
    `;
    }).join("");

    content.innerHTML = `
        <h2>${route.name}</h2>
        <p><strong>From:</strong> ${route.from}</p>
        <p><strong>To:</strong> ${route.to}</p>
        <p><strong>Duration:</strong> ${route.duration}</p>
        <hr>
        <div class="route-steps">${stepsHTML}</div>
    `;

    panel.classList.add("active");
});

function showFavoriteRoutePanel(route) {
    const panel = document.getElementById("routeDetailsPanel");
    const content = document.getElementById("routeDetailsContent");
    if (!panel || !content) return;

    const icons = {
        walk: "icons/walking.png",
        bus: "icons/bus.png",
        train: "icons/train.png",
    };

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

    const stepsHTML = (route.steps || [])
        .map((s) => {
            const icon = icons[s.type] || icons.walk;

            // pick a color if it's a CTA rail line, otherwise fall back to what we saved
            const lineColor =
                Object.entries(lineColors).find(([name]) =>
                    (s.routeName || "").toLowerCase().includes(name.toLowerCase())
                )?.[1] || s.color || "#555";

            const isWalking = s.type === "walk";

            // main instruction line
            const instructionText = s.instructions
                ? s.instructions
                : isWalking
                    ? `Walk ${s.distance || ""} (${s.durationStep || s.duration || ""})`
                    : `${s.departureStop || ""} → ${s.arrivalStop || ""}`;

            // detail line: times, stops, distance
            const detailParts = [];
            if (s.departureTime && s.arrivalTime) {
                detailParts.push(`${s.departureTime} → ${s.arrivalTime}`);
            }
            if (s.numStops) {
                detailParts.push(`${s.numStops} stops`);
            }
            if (s.distance) {
                detailParts.push(s.distance);
            }
            const detailText = detailParts.join(" • ");

            return `
            <div class="step">
                <img src="${icon}" class="step-icon" />
                <div>
                    <strong>${instructionText}</strong><br>
                    ${detailText ? `<small>${detailText}</small><br>` : ""}
                    ${(s.type === "train" || s.type === "bus") && s.routeName
                ? `<span class="route-chip" style="background-color:${lineColor};color:white">${s.routeName}</span>`
                : ""}
                </div>
            </div>
        `;
        })
        .join("");

    content.innerHTML = `
        <h2>${route.name}</h2>
        <p><strong>From:</strong> ${route.from}</p>
        <p><strong>To:</strong> ${route.to}</p>
        <p><strong>Duration:</strong> ${route.duration}</p>
        <hr>
        <div class="route-steps">${stepsHTML}</div>
    `;

    panel.classList.add("active");
}

// ---------- Route Details Panel ----------
function showRouteDetails(route) {
    const panel = document.getElementById("routeDetailsPanel");
    const content = document.getElementById("routeDetailsContent");

    const walkIcon = "icons/walking.png";

    content.innerHTML = `
        <h2>${route.name}</h2>
        <p><strong>From:</strong> ${route.from}</p>
        <p><strong>To:</strong> ${route.to}</p>
        <p><strong>Arrival Time:</strong> ${route.arrival || "N/A"}</p>
        <hr>
        <div class="route-steps">
            <div class="step"><img src="${walkIcon}" class="step-icon" /> Walk to starting stop</div>
            <div class="step"><img src="icons/bus.png" class="step-icon" /> Take connecting bus/train</div>
            <div class="step"><img src="icons/train.png" class="step-icon" /> Arrive near destination</div>
            <div class="step"><img src="${walkIcon}" class="step-icon" /> Walk to destination</div>
        </div>
    `;

    panel.classList.add("active");
}

document.getElementById("closeRouteDetails")?.addEventListener("click", () => {
    document.getElementById("routeDetailsPanel").classList.remove("active");
});


// ---------- Preferences System ----------
function loadPreferences() {
    const prefs = JSON.parse(localStorage.getItem("preferences") || "{}");

    document.getElementById("prefBus").checked = prefs.bus ?? true;
    document.getElementById("prefTrain").checked = prefs.train ?? true;
}

document.getElementById("savePreferencesBtn")?.addEventListener("click", () => {
    const busChecked = document.getElementById("prefBus").checked;
    const trainChecked = document.getElementById("prefTrain").checked;

    localStorage.setItem(
        "preferences",
        JSON.stringify({
            bus: busChecked,
            train: trainChecked,
        })
    );

    alert("Preferences saved!");
});

loadPreferences();

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
        clearDisplayedRoute();

        const fromValue = fromInput.value.trim();
        const toValue = toInput.value.trim();
        if (!toValue) return alert("Please enter a destination.");

        const res = await fetch(`${API_BASE}/google-key`);
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