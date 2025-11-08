let map; // global map variable so we can modify it later
let userMarker;
let destinationMarker;

// ---------- GOOGLE MAPS LOADING ----------
async function loadGoogleMaps() {
    try {
        const res = await fetch("http://localhost:5000/api/google-key");
        const data = await res.json();

        if (!data.key) {
            console.error("Google Maps API key not available.");
            return;
        }

        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${data.key}&callback=initMap`;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
    } catch (err) {
        console.error("Error loading Google Maps:", err);
    }
}

// ---------- MAP INITIALIZATION ----------
window.initMap = function () {
    if (!navigator.geolocation) {
        alert("Geolocation not supported by your browser.");
        return;
    }

    navigator.geolocation.getCurrentPosition((pos) => {
        const {latitude, longitude} = pos.coords;

        map = new google.maps.Map(document.getElementById("map"), {
            center: {lat: latitude, lng: longitude},
            zoom: 15,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
        });

        userMarker = new google.maps.Marker({
            position: {lat: latitude, lng: longitude}, map, title: "You are here", icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 8,
                fillColor: "#4285F4",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "white",
            },
        });
    }, (err) => {
        console.error("Error getting location:", err);
        alert("Unable to get your location. Please enable location access.");
    });
};

// ---------- DESTINATION SEARCH ----------
async function searchDestination(queryOverride = null) {
    const input = document.getElementById("destination");
    const query = queryOverride || input.value.trim();

    if (!query) {
        alert("Please enter a destination.");
        return;
    }

    try {
        const res = await fetch("http://localhost:5000/api/google-key");
        const data = await res.json();
        const key = data.key;

        if (!key) {
            console.error("Google Maps API key not available.");
            return;
        }

        const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`);
        const geoData = await geoRes.json();

        if (geoData.status !== "OK" || !geoData.results.length) {
            alert("No location found for that destination.");
            return;
        }

        const location = geoData.results[0].geometry.location;

        // Ensure map exists before using it
        if (!map) {
            console.error("Map not initialized yet.");
            return;
        }

        map.setCenter(location);
        map.setZoom(15);

        if (destinationMarker) destinationMarker.setMap(null);
        destinationMarker = new google.maps.Marker({
            position: location,
            map,
            title: geoData.results[0].formatted_address,
            icon: "http://maps.google.com/mapfiles/ms/icons/red-dot.png",
        });
    } catch (err) {
        console.error("Error finding destination:", err);
    }
}

// ---------- SIDE PANEL INTERACTION ----------
document.addEventListener("DOMContentLoaded", () => {
    const openPanelBtn = document.getElementById("openPanel");
    const closePanelBtn = document.getElementById("closePanel");
    const sidePanel = document.getElementById("sidePanel");
    const destinationInput = document.getElementById("destination");
    const panelFrom = document.getElementById("panelFrom");
    const panelInput = document.getElementById("panelDestination");
    const planBtn = document.querySelector(".plan-btn");

    // Open / close panel
    if (openPanelBtn && closePanelBtn && sidePanel) {
        openPanelBtn.addEventListener("click", () => {
            const destinationValue = destinationInput.value.trim();

            if (destinationValue) {
                searchDestination(destinationValue);
            }

            if (panelInput) {
                panelInput.value = destinationValue;
            }

            sidePanel.classList.add("active");
        });

        closePanelBtn.addEventListener("click", () => {
            sidePanel.classList.remove("active");
        });
    }

    let fromMarker = null; // move this to global scope at the top of your file

    // “Search” button inside the side panel triggers both “From” and “To” lookups
    if (planBtn) {
        planBtn.addEventListener("click", async (e) => {
            e.preventDefault();

            const fromValue = panelFrom?.value.trim() || "";
            const toValue = panelInput?.value.trim() || "";

            if (!toValue && !fromValue) {
                alert("Please enter at least one location.");
                return;
            }

            const res = await fetch("http://localhost:5000/api/google-key");
            const data = await res.json();
            const key = data.key;

            if (!key) {
                console.error("Google Maps API key not available.");
                return;
            }

            const bounds = new google.maps.LatLngBounds();

            // Helper: geocode and drop a colored marker
            async function addMarker(address, color) {
                if (!address) return null;

                const geoRes = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
                const geoData = await geoRes.json();

                if (geoData.status === "OK" && geoData.results.length > 0) {
                    const location = geoData.results[0].geometry.location;
                    const marker = new google.maps.Marker({
                        position: location, map, title: address, icon: {
                            url: `http://maps.google.com/mapfiles/ms/icons/${color}-dot.png`,
                        },
                    });
                    bounds.extend(location);
                    return marker;
                }
                return null;
            }

            // Clear old markers before adding new ones
            if (fromMarker) fromMarker.setMap(null);
            if (destinationMarker) destinationMarker.setMap(null);

            // If "From" is blank use user’s current GPS location
            if (!fromValue) {
                await new Promise((resolve) => {
                    navigator.geolocation.getCurrentPosition((pos) => {
                        const {latitude, longitude} = pos.coords;
                        const location = {lat: latitude, lng: longitude};

                        fromMarker = new google.maps.Marker({
                            position: location, map, title: "Your Location", icon: {
                                url: `http://maps.google.com/mapfiles/ms/icons/blue-dot.png`,
                            },
                        });
                        bounds.extend(location);
                        resolve();
                    }, (err) => {
                        console.error("Error getting current location:", err);
                        alert("Unable to get your current location.");
                        resolve();
                    });
                });
            } else {
                // Use entered address for the "From" field
                fromMarker = await addMarker(fromValue, "blue");
            }

            // Add destination marker
            destinationMarker = await addMarker(toValue, "red");

            // Fit the map to show both
            if (fromMarker || destinationMarker) {
                map.fitBounds(bounds);
            }

            // Keep the side panel open
        });
    }
});

// Start by fetching and loading the map
loadGoogleMaps();
