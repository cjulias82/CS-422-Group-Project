/* ----------------------------------------------
   GLOBAL STATE
---------------------------------------------- */
let map;
let fromMarker = null;
let destinationMarker = null;

let directionsService;
let directionsRenderer;

// Firebase Cloud Function API base:
const API_BASE = "https://api-dt26u5phza-uc.a.run.app";

/* ----------------------------------------------
   LOAD GOOGLE MAPS
---------------------------------------------- */
async function loadGoogleMaps() {
    try {
        const res = await fetch(`${API_BASE}/google-key`);
        const data = await res.json();

        if (!data.key) {
            console.error("Google Maps API key missing from backend.");
            return;
        }

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${data.key}&callback=initMap`;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);

    } catch (err) {
        console.error("Error loading Google Maps key:", err);
    }
}

/* ----------------------------------------------
   INITIALIZE MAP
---------------------------------------------- */
window.initMap = function () {
    const fallbackCenter = { lat: 41.8781, lng: -87.6298 }; // Chicago fallback

    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 13,
        center: fallbackCenter,
    });

    // Try geolocation
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                const userLoc = { lat: latitude, lng: longitude };
                map.setCenter(userLoc);

                new google.maps.Marker({
                    position: userLoc,
                    map,
                    title: "Your Location",
                });
            },
            () => console.warn("Geolocation blocked — using fallback center.")
        );
    }

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map,
        suppressMarkers: true,
    });
};

/* ----------------------------------------------
   REQUEST TRANSIT ROUTES FROM BACKEND
---------------------------------------------- */
async function showTransitRoutes(fromValue, toValue) {
    const routeList = document.getElementById("routeList");
    routeList.innerHTML = "<li>Loading routes...</li>";

    try {
        const res = await fetch(
            `${API_BASE}/routes?from=${encodeURIComponent(fromValue)}&to=${encodeURIComponent(toValue)}`
        );

        const data = await res.json();

        if (!data.routes || !data.routes.length) {
            routeList.innerHTML = "<li>No routes found.</li>";
            return;
        }

        routeList.innerHTML = "";

        const saved = JSON.parse(localStorage.getItem("savedRoutes") || "[]");

        data.routes.forEach((route, index) => {
            const item = document.createElement("li");
            item.classList.add("route-item");

            const name = `${route.steps?.[0]?.routeName || "Route"} (${route.duration})`;

            const isSaved = saved.some(
                (r) => r.name === name && r.from === fromValue && r.to === toValue
            );

            const starIcon = isSaved ? "icons/star.png" : "icons/favorite.png";

            const stepsHTML = route.steps
                ?.filter(s => s.type === "bus" || s.type === "train")
                .map((s) => {
                    const icon = s.type === "train" ? "icons/train.png" : "icons/bus.png";
                    return `
                        <div class="route-step">
                            <img src="${icon}" class="route-icon" />
                            <span>${s.departureTime || ""} → ${s.arrivalTime || ""}</span>
                            <span class="route-chip ${s.type}">${s.routeName}</span>
                        </div>
                    `;
                })
                .join("") || "";

            item.innerHTML = `
                <div class="route-summary">
                    <button class="fav-btn">
                        <img src="${starIcon}" class="fav-icon" />
                    </button>
                    <strong>${route.duration}</strong>
                    <div>${stepsHTML}</div>
                </div>
                <div class="directions-dropdown" style="display:none;"></div>
            `;

            // Toggle dropdown
            item.querySelector(".route-summary").addEventListener("click", async (e) => {
                if (e.target.closest(".fav-btn")) return;

                const dropdown = item.querySelector(".directions-dropdown");
                const isOpen = dropdown.style.display === "block";

                document.querySelectorAll(".directions-dropdown").forEach(el => el.style.display = "none");

                if (!isOpen) {
                    dropdown.style.display = "block";
                    dropdown.innerHTML = "<p>Loading directions...</p>";
                    await drawRouteOnMap(fromValue, toValue, index, dropdown);
                }
            });

            routeList.appendChild(item);
        });
    } catch (err) {
        console.error("Route fetch error:", err);
        routeList.innerHTML = "<li>Error loading routes.</li>";
    }
}

/* ----------------------------------------------
   DRAW DIRECTIONS ON THE MAP
---------------------------------------------- */
async function drawRouteOnMap(fromValue, toValue, routeIndex = 0, dropdown = null) {
    try {
        directionsRenderer.setMap(map);

        directionsService.route(
            {
                origin: fromValue,
                destination: toValue,
                travelMode: google.maps.TravelMode.TRANSIT,
                provideRouteAlternatives: true,
            },
            (result, status) => {
                if (status !== "OK") {
                    console.error("Directions failed:", status);
                    if (dropdown) dropdown.innerHTML = "<p>Unable to load directions.</p>";
                    return;
                }

                const chosenRoute = result.routes[Math.min(routeIndex, result.routes.length - 1)];
                directionsRenderer.setDirections({ ...result, routes: [chosenRoute] });

                if (chosenRoute.bounds) map.fitBounds(chosenRoute.bounds);

                if (!dropdown) return;

                const leg = chosenRoute.legs[0];
                dropdown.innerHTML = `<h4>Directions</h4>`;

                leg.steps.forEach((step) => {
                    const icon = step.travel_mode === "TRANSIT"
                        ? step.transit?.line?.vehicle?.type?.includes("BUS")
                            ? "icons/bus.png"
                            : "icons/train.png"
                        : "icons/walking.png";

                    dropdown.innerHTML += `
                        <div class="direction-step">
                            <img src="${icon}" class="route-icon" />
                            <div>
                                <strong>${step.html_instructions || "Continue"}</strong><br>
                                <small>${step.duration?.text || ""}</small>
                            </div>
                        </div>
                    `;
                });
            }
        );
    } catch (err) {
        console.error("Draw route error:", err);
        if (dropdown) dropdown.innerHTML = "<p>Error generating directions.</p>";
    }
}

/* ----------------------------------------------
   SIDEBAR & UI LOGIC
---------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
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

        await showTransitRoutes(fromValue || "Chicago, IL", toValue);
    });
});

/* ----------------------------------------------
   RUN
---------------------------------------------- */
loadGoogleMaps();
