let map;
let fromMarker = null;
let destinationMarker = null;

let directionsService;
let directionsRenderer;
let activeRouteIndex = null;

// ---------- Load Google Maps ----------
async function loadGoogleMaps() {
    const res = await fetch("http://localhost:5000/api/google-key");
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
        const {latitude, longitude} = pos.coords;
        map = new google.maps.Map(document.getElementById("map"), {
            center: {lat: latitude, lng: longitude}, zoom: 14,
        });
        new google.maps.Marker({
            position: {lat: latitude, lng: longitude}, map, title: "Your Location",
        });
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map, suppressMarkers: true, // we'll handle markers manually
        preserveViewport: false
    });
};

// ---------- Show Transit Routes ----------
async function showTransitRoutes(fromValue, toValue) {
    const routeList = document.getElementById("routeList");
    routeList.innerHTML = "<li>Loading routes...</li>";

    const res = await fetch(`http://localhost:5000/api/routes?from=${encodeURIComponent(fromValue)}&to=${encodeURIComponent(toValue)}`);
    const data = await res.json();

    if (!data.routes || data.routes.length === 0) {
        routeList.innerHTML = "<li>No routes found.</li>";
        return;
    }

    routeList.innerHTML = "";
    data.routes.forEach((route, index) => {
        const item = document.createElement("li");
        item.classList.add("route-item");

        const stepsHTML = route.steps
            .map((s) => {
                let iconUrl = "";
                if (s.type === "train") iconUrl = "icons/train.png"; else if (s.type === "bus") iconUrl = "icons/bus.png";

                const iconImg = iconUrl ? `<img src="${iconUrl}" class="route-icon" alt="${s.type}" />` : "";

                return `
      <div class="route-step">
        ${iconImg}
        <span>${s.departureTime || ""} → ${s.arrivalTime || ""}</span>
        <span class="route-chip ${s.type}">${s.routeName}</span>
      </div>
    `;
            })
            .join("");

        item.innerHTML = `
            <div class="route-summary">
                <strong>${route.duration}</strong>
                <div>${stepsHTML}</div>
            </div>
        `;

        // Add click event to show route on map
        item.addEventListener("click", async () => {
            // Remove highlight from previous selection
            document.querySelectorAll(".route-item").forEach((el) => el.classList.remove("active"));
            item.classList.add("active");

            // Request directions and draw on map
            await drawRouteOnMap(fromValue, toValue, index);
            // activeRouteIndex = index;
        });

        routeList.appendChild(item);
    });
}

async function drawRouteOnMap(fromValue, toValue, routeIndex = 0) {
    if (!directionsService || !directionsRenderer) {
        console.error("Directions services not initialized.");
        return;
    }

    directionsRenderer.setMap(map); // ensure attached

    const request = {
        origin: fromValue,
        destination: toValue,
        travelMode: google.maps.TravelMode.TRANSIT,
        provideRouteAlternatives: true, // get all options in one call
    };

    directionsService.route(request, (result, status) => {
        if (status !== google.maps.DirectionsStatus.OK) {
            console.error("Directions request failed:", status);
            alert("Unable to draw route. Try again.");
            return;
        }

        // Guard against out-of-range index
        const idx = Math.min(routeIndex, result.routes.length - 1);

        // Build a new DirectionsResult containing ONLY the selected route
        const singleResult = {
            ...result, routes: [result.routes[idx]]
        };

        // Clear old custom markers (if any)
        if (window.startMarker) window.startMarker.setMap(null);
        if (window.endMarker) window.endMarker.setMap(null);

        // Render only the chosen route
        directionsRenderer.setDirections(singleResult);

        // Fit to that route’s bounds
        if (singleResult.routes[0].bounds) {
            map.fitBounds(singleResult.routes[0].bounds);
        }

    });
}

async function showNearbyRoutes(lat, lng) {
    try {
        const res = await fetch(`http://localhost:5000/api/nearby-routes?lat=${lat}&lng=${lng}`);
        const data = await res.json();

        if (!data.results || data.results.length === 0) {
            console.log("No nearby routes found.");
            return;
        }

        data.results.forEach((place) => {
            new google.maps.Marker({
                position: place.location, map, title: place.name, icon: {
                    url: place.types.includes("bus_station") ? "http://maps.google.com/mapfiles/ms/icons/green-dot.png" : "http://maps.google.com/mapfiles/ms/icons/purple-dot.png",
                },
            });
        });

        console.log(`Loaded ${data.results.length} nearby stops`);
    } catch (err) {
        console.error("Error fetching nearby routes:", err);
    }
}


// ---------- Side Panel ----------
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

        const res = await fetch("http://localhost:5000/api/google-key");
        const data = await res.json();
        const key = data.key;

        const bounds = new google.maps.LatLngBounds();

        async function geocode(address, color) {
            const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
            const geoData = await geoRes.json();
            if (geoData.status === "OK" && geoData.results.length > 0) {
                const location = geoData.results[0].geometry.location;
                const marker = new google.maps.Marker({
                    position: location, map, icon: {url: `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png`},
                });
                bounds.extend(location);
                return marker;
            }
        }

        if (fromMarker) fromMarker.setMap(null);
        if (destinationMarker) destinationMarker.setMap(null);

        if (!fromValue) {
            navigator.geolocation.getCurrentPosition((pos) => {
                const location = {lat: pos.coords.latitude, lng: pos.coords.longitude};
                fromMarker = new google.maps.Marker({
                    position: location, map, icon: {url: `http://maps.google.com/mapfiles/ms/icons/blue-dot.png`},
                });
                bounds.extend(location);
            });
        } else {
            fromMarker = await geocode(fromValue, "blue");
        }

        destinationMarker = await geocode(toValue, "red");
        map.fitBounds(bounds);

        await showTransitRoutes(fromValue || "current location", toValue);

        // Show all nearby bus/train stops from the "From" location
        if (fromMarker) {
            const pos = fromMarker.getPosition();
            await showNearbyRoutes(pos.lat(), pos.lng());
        }
    });
});

loadGoogleMaps();
