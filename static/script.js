// ===== CONSTRUCTION WORKER SAFETY MONITORING SYSTEM =====
// JavaScript for Navigation, Real-time Updates, and Voice Alerts

// ===== GLOBAL STATE =====

const state = {
    currentSection: 'dashboard',
    ppeScore: 100,
    aiScore: 100,
    alertHistory: [],
    alertsHydrated: false,
    startTime: Date.now(),
    dataUpdateInterval: null,
    voiceAlertEnabled: true
};

// ===== INITIALIZATION =====

document.addEventListener('DOMContentLoaded', function () {
    console.log('Application initialized');
    initializeNavigation();
    startDataUpdates();
    setupEventListeners();
});

// ===== NAVIGATION SYSTEM =====

/**
 * Initializes the navigation button event listeners.
 * Handles switching between Dashboard, Live Monitor, Alerts, and Reports sections.
 */
function initializeNavigation() {
    const navButtons = document.querySelectorAll('.nav-button');

    navButtons.forEach(button => {
        button.addEventListener('click', function () {
            const sectionId = this.getAttribute('data-section');
            switchSection(sectionId);
        });
    });
}

/**
 * Switches the active section and updates the UI.
 * @param {string} sectionId - The ID of the section to display.
 */
function switchSection(sectionId) {
    // Hide all sections
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.classList.remove('active');
    });

    // Show the selected section
    const selectedSection = document.getElementById(sectionId);
    if (selectedSection) {
        selectedSection.classList.add('active');
    }

    // Update active button
    const navButtons = document.querySelectorAll('.nav-button');
    navButtons.forEach(button => {
        button.classList.remove('active');
        if (button.getAttribute('data-section') === sectionId) {
            button.classList.add('active');
        }
    });

    // Update state
    state.currentSection = sectionId;
    console.log(`Switched to section: ${sectionId}`);
}

// ===== DATA FETCHING AND UPDATES =====

/**
 * Starts the periodic data updates from the Flask backend.
 * Fetches PPE compliance score, AI safety score, and alert history every 2 seconds.
 */
function startDataUpdates() {
    // Fetch data immediately on start
    fetchDataFromBackend();

    // Set up interval for continuous updates
    state.dataUpdateInterval = setInterval(fetchDataFromBackend, 2000);
}

/**
 * Fetches real-time data from the Flask backend.
 */
function fetchDataFromBackend() {
    fetch('/data_feed')
        .then(response => response.json())
        .then(data => {
            updateDashboard(data);
            updateLiveMonitor(data);
            updateAlerts(data);
            updateReports(data);
        })
        .catch(error => console.error('Error fetching data:', error));
}

/**
 * Updates the Dashboard section with real-time data.
 * @param {object} data - The data object from the backend.
 */
function updateDashboard(data) {
    const ppeScore = data.ppe_compliance_score;
    const aiScore = data.ai_safety_score;

    // Update PPE Compliance Score
    const ppeScoreElement = document.getElementById('ppe-score');
    if (ppeScoreElement) {
        ppeScoreElement.textContent = Math.round(ppeScore);
        updateScoreRing('ppe-score', ppeScore);
    }

    // Update AI Safety Score
    const aiScoreElement = document.getElementById('ai-score');
    if (aiScoreElement) {
        aiScoreElement.textContent = Math.round(aiScore);
        updateScoreRing('ai-score', aiScore);
    }

    // Update Active Alerts Count
    const alertCountElement = document.getElementById('alert-count');
    if (alertCountElement) {
        alertCountElement.textContent = data.alert_history.length;
    }

    // Update Detection Statistics
    const totalPersons = document.getElementById("total-persons");
    if (totalPersons) {
        totalPersons.textContent = data.total_persons;
    }

    const helmetsCount = document.getElementById("helmets-count");
    if (helmetsCount) {
        helmetsCount.textContent = data.helmets_count;
    }

    const masksCount = document.getElementById("masks-count");
    if (masksCount) {
        masksCount.textContent = data.masks_count;
    }

    const vestsCount = document.getElementById("vests-count");
    if (vestsCount) {
        vestsCount.textContent = data.vests_count;
    }

    // Scores only. Alert history is compared in updateAlerts() before state is updated.
    state.ppeScore = ppeScore;
    state.aiScore = aiScore;
}

/**
 * Updates the score ring SVG animation based on the score value.
 * @param {string} elementId - The ID of the score element.
 * @param {number} score - The score value (0-100).
 */
function updateScoreRing(elementId, score) {
    const scoreElement = document.getElementById(elementId);
    if (!scoreElement) return;

    // Find the SVG circle in the parent container
    const scoreCircle = scoreElement.closest('.score-circle');
    if (!scoreCircle) return;

    const svgCircle = scoreCircle.querySelector('.score-ring-circle-fill');
    if (!svgCircle) return;

    // Calculate stroke-dashoffset based on score
    // Full circle circumference: 2 * π * r = 2 * π * 66 ≈ 414
    const circumference = 414;
    const offset = circumference - (score / 100) * circumference;
    svgCircle.style.strokeDashoffset = offset;

    // Change color based on score
    if (score >= 80) {
        svgCircle.style.stroke = '#00ff88'; // Green
    } else if (score >= 50) {
        svgCircle.style.stroke = '#ff9500'; // Orange
    } else {
        svgCircle.style.stroke = '#ff3366'; // Red
    }
}

/**
 * Updates the Live Monitor section with real-time data.
 * @param {object} data - The data object from the backend.
 */
function updateLiveMonitor(data) {
    const livePpeScore = document.getElementById('live-ppe-score');
    if (livePpeScore) {
        livePpeScore.textContent = Math.round(data.ppe_compliance_score) + '%';
    }

    const liveAiScore = document.getElementById('live-ai-score');
    if (liveAiScore) {
        liveAiScore.textContent = Math.round(data.ai_safety_score) + '%';
    }

    const liveAlertCount = document.getElementById('live-alert-count');
    if (liveAlertCount) {
        liveAlertCount.textContent = data.alert_history.length;
    }
}

/**
 * Updates the Alerts section with the latest alert history.
 * @param {object} data - The data object from the backend.
 */
function updateAlerts(data) {
    const alertsList = document.getElementById('alerts-list');
    if (!alertsList) return;

    const previousAlerts = state.alertHistory;
    const alerts = data.alert_history || [];

    // Speak only for a genuine new alert after the first backend snapshot.
    // Page load / refresh of existing history must not trigger speech.
    if (state.alertsHydrated && alerts.length > previousAlerts.length) {
        playVoiceAlert();
    }

    if (alerts.length === 0) {
        alertsList.innerHTML = '<div class="no-alerts-message"><p>No violations detected. All workers are compliant with PPE requirements.</p></div>';
    } else {
        let alertsHTML = '';
        alerts.forEach((alert) => {
            const timestamp = alert.timestamp;
            const violation = alert.violation;
            const imagePath = alert.image_path;

            alertsHTML += `
            <div class="alert-item">
                <div class="alert-item-content">
                    <div class="alert-time">${timestamp}</div>
                    <div class="alert-violation">⚠️ ${violation}</div>
                </div>
                <img src="${imagePath}" alt="Violation Screenshot" class="alert-item-image" onclick="viewAlertImage('${imagePath}')">
            </div>
        `;
        });
        alertsList.innerHTML = alertsHTML;
    }

    state.alertHistory = [...alerts];
    state.alertsHydrated = true;
}

/**
 * Updates the Reports section with compliance statistics.
 * @param {object} data - The data object from the backend.
 */
function updateReports(data) {
    // Current snapshot scores (not time-averaged)
    const avgPpeCompliance = document.getElementById('avg-ppe-compliance');
    if (avgPpeCompliance) {
        avgPpeCompliance.textContent = Math.round(data.ppe_compliance_score) + '%';
    }

    const avgAiSafety = document.getElementById('avg-ai-safety');
    if (avgAiSafety) {
        avgAiSafety.textContent = Math.round(data.ai_safety_score) + '%';
    }

    // Total Violations
    const totalViolations = document.getElementById('total-violations');
    if (totalViolations) {
        totalViolations.textContent = data.alert_history.length;
    }

    // Monitoring Duration
    const monitoringDuration = document.getElementById('monitoring-duration');
    if (monitoringDuration) {
        const duration = calculateMonitoringDuration();
        monitoringDuration.textContent = duration;
    }

    // Violation Breakdown (simplified - counts from alert history)
    const noHelmetCount = data.alert_history.filter(a => a.violation === 'No Helmet').length;
    const noMaskCount = data.alert_history.filter(a => a.violation === 'No Mask').length;
    const noVestCount = data.alert_history.filter(a => a.violation === 'No Safety Vest').length;

    const noHelmetElement = document.getElementById('no-helmet-count');
    if (noHelmetElement) noHelmetElement.textContent = noHelmetCount;

    const noMaskElement = document.getElementById('no-mask-count');
    if (noMaskElement) noMaskElement.textContent = noMaskCount;

    const noVestElement = document.getElementById('no-vest-count');
    if (noVestElement) noVestElement.textContent = noVestCount;
}

/**
 * Calculates the monitoring duration since the application started.
 * @returns {string} The duration in "Xh Ym" format.
 */
function calculateMonitoringDuration() {
    const elapsed = Date.now() - state.startTime;
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

// ===== EVENT LISTENERS SETUP =====

/**
 * Sets up event listeners for buttons and interactive elements.
 */
function setupEventListeners() {
    // Clear Alerts Button
    const clearAlertsBtn = document.getElementById('clear-alerts-btn');
    if (clearAlertsBtn) {
        clearAlertsBtn.addEventListener('click', clearAlerts);
    }

    // Export Buttons
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', exportReportAsPDF);
    }

    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', exportReportAsCSV);
    }

    const exportJsonBtn = document.getElementById('export-json-btn');
    if (exportJsonBtn) {
        exportJsonBtn.addEventListener('click', exportReportAsJSON);
    }
}

// ===== ALERT MANAGEMENT =====

/**
 * Clears all alerts after the backend and SQLite have confirmed the delete.
 */
function clearAlerts() {
    fetch('/clear_alerts', { method: 'POST' })
        .then(response => {
            if (!response.ok) {
                throw new Error('Backend returned ' + response.status);
            }
            return response.json();
        })
        .then(result => {
            if (!result || result.success !== true) {
                throw new Error('Clear request was not successful');
            }
            applyClearedAlertDisplay();
            console.log('All alerts cleared');
        })
        .catch(error => {
            console.error('Error clearing alerts:', error);
            window.alert('Could not clear alerts. Please try again.');
        });
}

function applyClearedAlertDisplay() {
    state.alertHistory = [];
    state.alertsHydrated = true;

    const alertsList = document.getElementById('alerts-list');
    if (alertsList) {
        alertsList.innerHTML = '<div class="no-alerts-message"><p>No violations detected. All workers are compliant with PPE requirements.</p></div>';
    }

    const alertCountElement = document.getElementById('alert-count');
    if (alertCountElement) {
        alertCountElement.textContent = '0';
    }

    const liveAlertCount = document.getElementById('live-alert-count');
    if (liveAlertCount) {
        liveAlertCount.textContent = '0';
    }

    const totalViolations = document.getElementById('total-violations');
    if (totalViolations) {
        totalViolations.textContent = '0';
    }
}

/**
 * Views an alert image in a modal or new window.
 * @param {string} imagePath - The path to the image file.
 */
function viewAlertImage(imagePath) {
    // Simple implementation: open in new window
    // For a more sophisticated approach, you could use a modal
    window.open(imagePath, '_blank');
    console.log(`Viewing alert image: ${imagePath}`);
}

/**
 * Plays a voice alert sound.
 * This can be enhanced with Web Audio API or by using an audio element.
 */
function playVoiceAlert() {

    const speech = new SpeechSynthesisUtterance(
        "Warning. PPE violation detected."
    );

    speech.volume = 1;
    speech.rate = 1;
    speech.pitch = 1;

    window.speechSynthesis.speak(speech);

}


// ===== EXPORT FUNCTIONS =====

/**
 * Exports the report as a PDF file.
 */
function exportReportAsPDF() {

    const { jsPDF } = window.jspdf;

    const doc = new jsPDF();

    const report = generateReportData();

    doc.setFontSize(18);
    doc.text("Construction Worker Safety Report", 20, 20);

    doc.setFontSize(12);

    doc.text("PPE Compliance : " + report.ppeScore + "%", 20, 40);
    doc.text("AI Safety Score : " + report.aiScore + "%", 20, 50);
    doc.text("Total Violations : " + report.totalViolations, 20, 60);
    doc.text("Monitoring Duration : " + report.duration, 20, 70);

    doc.text("Violation Counts", 20, 90);

    doc.text("No Helmet : " + report.noHelmet, 30, 100);
    doc.text("No Mask : " + report.noMask, 30, 110);
    doc.text("No Safety Vest : " + report.noVest, 30, 120);

    doc.save("Safety_Report.pdf");
}
/**
 * Exports the report as a CSV file.
 */
function exportReportAsCSV() {
    const reportData = generateReportData();
    let csvContent = 'Timestamp,Violation Type\n';

    reportData.alertHistory.forEach(alert => {
        csvContent += `"${alert.timestamp}","${alert.violation}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    downloadFile(blob, 'safety_report.csv');
    console.log('Report exported as CSV');
}

/**
 * Exports the report as a JSON file.
 */
function exportReportAsJSON() {
    const reportData = generateReportData();
    const jsonContent = JSON.stringify(reportData, null, 2);

    const blob = new Blob([jsonContent], { type: 'application/json' });
    downloadFile(blob, 'safety_report.json');
    console.log('Report exported as JSON');
}

/**
 * Generates report data from the current state.
 * @returns {object} The report data object.
 */
function generateReportData() {
    const noHelmetCount = state.alertHistory.filter(a => a.violation === 'No Helmet').length;
    const noMaskCount = state.alertHistory.filter(a => a.violation === 'No Mask').length;
    const noVestCount = state.alertHistory.filter(a => a.violation === 'No Safety Vest').length;

    return {
        ppeScore: Math.round(state.ppeScore),
        aiScore: Math.round(state.aiScore),
        totalViolations: state.alertHistory.length,
        duration: calculateMonitoringDuration(),
        noHelmet: noHelmetCount,
        noMask: noMaskCount,
        noVest: noVestCount,
        alertHistory: state.alertHistory,
        generatedAt: new Date().toLocaleString()
    };
}

/**
 * Downloads a file by creating a temporary link and clicking it.
 * @param {Blob} blob - The file blob to download.
 * @param {string} filename - The name of the file to download.
 */
function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// ===== UTILITY FUNCTIONS =====

/**
 * Logs a message to the console with a timestamp.
 * @param {string} message - The message to log.
 */
function logMessage(message) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
}

/**
 * Handles window resize events for responsive design.
 */
window.addEventListener('resize', function () {
    console.log(`Window resized: ${window.innerWidth}x${window.innerHeight}`);
});

/**
 * Handles page visibility changes (when user switches tabs).
 */
document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
        console.log('Application is now hidden');
    } else {
        console.log('Application is now visible');
        // Refresh data when user returns to the tab
        fetchDataFromBackend();
    }
});

// ===== KEYBOARD SHORTCUTS =====

/**
 * Handles keyboard shortcuts for navigation.
 */
document.addEventListener('keydown', function (event) {
    // Alt + 1: Dashboard
    if (event.altKey && event.key === '1') {
        switchSection('dashboard');
    }
    // Alt + 2: Live Monitor
    else if (event.altKey && event.key === '2') {
        switchSection('live-monitor');
    }
    // Alt + 3: Alerts
    else if (event.altKey && event.key === '3') {
        switchSection('alerts');
    }
    // Alt + 4: Reports
    else if (event.altKey && event.key === '4') {
        switchSection('reports');
    }
});

// ===== PERFORMANCE MONITORING =====

/**
 * Monitors performance metrics and logs them periodically.
 */
function monitorPerformance() {
    if (performance.memory) {
        const memoryUsage = {
            usedJSHeapSize: (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + ' MB',
            totalJSHeapSize: (performance.memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB',
            jsHeapSizeLimit: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2) + ' MB'
        };
        console.log('Memory Usage:', memoryUsage);
    }
}

// Monitor performance every 30 seconds
setInterval(monitorPerformance, 30000);

// ===== APPLICATION READY MESSAGE =====

console.log('Construction Worker Safety Monitoring System - Ready');
console.log('Keyboard Shortcuts: Alt+1 (Dashboard), Alt+2 (Live Monitor), Alt+3 (Alerts), Alt+4 (Reports)');

/* ============================================================
   FINAL SAFETY ALERT + VOICE + REPORT SYSTEM
   ============================================================ */


/* ------------------------------------------------------------
   VIOLATION DESCRIPTION
   ------------------------------------------------------------ */

function violationSentence(violation) {

    const descriptions = {

        "No Helmet":
            "This worker is not wearing a helmet.",

        "No Mask":
            "This worker is not wearing a mask.",

        "No Safety Vest":
            "This worker is not wearing a safety vest.",

        "No Gloves":
            "This worker is not wearing safety gloves."

    };

    return descriptions[violation] ||
        "This worker does not satisfy the required safety condition.";
}


/* ------------------------------------------------------------
   AUDIO SYSTEM
   ------------------------------------------------------------ */

let safetyAudioContext = null;

let safetyAudioUnlocked = false;


function unlockSafetyAudio() {

    try {

        if (!safetyAudioContext) {

            const AudioContext =
                window.AudioContext ||
                window.webkitAudioContext;

            if (AudioContext) {

                safetyAudioContext =
                    new AudioContext();

            }

        }


        if (
            safetyAudioContext &&
            safetyAudioContext.state === "suspended"
        ) {

            safetyAudioContext.resume();

        }


        safetyAudioUnlocked = true;

    } catch (error) {

        console.log(
            "Audio initialization failed:",
            error
        );

    }

}


/* Unlock audio after the user's first interaction */

document.addEventListener(
    "click",
    unlockSafetyAudio,
    {
        once: false,
        passive: true
    }
);


/* ------------------------------------------------------------
   SAFETY BEEP
   ------------------------------------------------------------ */

function playSafetyBeep() {

    try {

        unlockSafetyAudio();

        if (!safetyAudioContext) {
            return;
        }


        const oscillator =
            safetyAudioContext.createOscillator();

        const gain =
            safetyAudioContext.createGain();


        oscillator.type = "square";

        oscillator.frequency.setValueAtTime(
            880,
            safetyAudioContext.currentTime
        );


        gain.gain.setValueAtTime(
            0.001,
            safetyAudioContext.currentTime
        );


        gain.gain.exponentialRampToValueAtTime(
            0.18,
            safetyAudioContext.currentTime + 0.02
        );


        gain.gain.exponentialRampToValueAtTime(
            0.001,
            safetyAudioContext.currentTime + 0.35
        );


        oscillator.connect(gain);

        gain.connect(
            safetyAudioContext.destination
        );


        oscillator.start();

        oscillator.stop(
            safetyAudioContext.currentTime + 0.36
        );


    } catch (error) {

        console.log(
            "Safety beep failed:",
            error
        );

    }

}


/* ------------------------------------------------------------
   SPOKEN ALERT
   ------------------------------------------------------------ */

function speakSafetyAlert(alert) {

    if (
        !("speechSynthesis" in window)
    ) {

        return;

    }


    const worker =
        alert.worker_id !== null &&
            alert.worker_id !== undefined

            ? `Worker number ${alert.worker_id}`

            : "Worker";


    const violation =
        alert.violation ||
        "Safety violation";


    const sentence =
        violationSentence(
            violation
        );


    const message =
        `Warning. ${worker}. ${sentence}`;


    window.speechSynthesis.cancel();


    const speech =
        new SpeechSynthesisUtterance(
            message
        );


    speech.volume = 1;

    speech.rate = 0.9;

    speech.pitch = 1;


    window.speechSynthesis.speak(
        speech
    );

}


/* ------------------------------------------------------------
   COMPLETE ALERT SOUND
   ------------------------------------------------------------ */

function playWorkerSafetyAlert(alert) {

    playSafetyBeep();

    setTimeout(
        function () {

            speakSafetyAlert(
                alert
            );

        },
        150
    );

}


/* ============================================================
   ALERT DISPLAY
   ============================================================ */

function updateAlerts(data) {

    const alertsList =
        document.getElementById(
            "alerts-list"
        );


    if (!alertsList) {
        return;
    }


    const previousAlerts =
        state.alertHistory || [];


    const alerts =
        data.alert_history || [];


    /* Speak only for genuinely new alert */

    if (
        state.alertsHydrated &&
        alerts.length > 0
    ) {

        const newest =
            alerts[0];

        const previousNewest =
            previousAlerts[0];


        const isNewAlert =
            !previousNewest ||
            newest.timestamp !==
            previousNewest.timestamp ||
            newest.worker_id !==
            previousNewest.worker_id ||
            newest.violation !==
            previousNewest.violation;


        if (isNewAlert) {

            playWorkerSafetyAlert(
                newest
            );

        }

    }


    if (alerts.length === 0) {

        alertsList.innerHTML = `

            <div class="no-alerts-message">

                <p>
                    ✓ No violations detected.
                    All workers are compliant
                    with PPE requirements.
                </p>

            </div>

        `;

    } else {


        let alertsHTML = "";


        alerts.forEach(
            function (alert) {

                const worker =
                    alert.worker_id !== null &&
                        alert.worker_id !== undefined

                        ? `Worker #${alert.worker_id}`

                        : "Worker #—";


                const violation =
                    alert.violation ||
                    "Safety Violation";


                const description =
                    violationSentence(
                        violation
                    );


                const confidence =
                    alert.confidence !== null &&
                        alert.confidence !== undefined

                        ? (
                            Number(
                                alert.confidence
                            ) * 100
                        ).toFixed(1) + "%"

                        : "N/A";


                const imagePath =
                    alert.image_path ||
                    "";


                alertsHTML += `

                    <div class="alert-item">

                        <div class="alert-item-content">

                            <div class="alert-time">

                                ${alert.timestamp || ""}

                            </div>


                            <div class="alert-violation">

                                ⚠️ ${worker}
                                — ${violation}

                            </div>


                            <div class="alert-description">

                                ${description}

                            </div>


                            <div class="alert-confidence">

                                Confidence:
                                ${confidence}

                            </div>

                        </div>


                        ${imagePath
                        ?
                        `
                            <img
                                src="${imagePath}"
                                alt="Violation Evidence"
                                class="alert-item-image"
                                onclick="viewAlertImage('${imagePath}')"
                            >
                            `
                        :
                        ""
                    }

                    </div>

                `;

            }
        );


        alertsList.innerHTML =
            alertsHTML;

    }


    state.alertHistory =
        [...alerts];


    state.alertsHydrated =
        true;

}


/* ============================================================
   IMPROVED REPORT DATA
   ============================================================ */

function generateReportData() {

    const alerts =
        state.alertHistory || [];


    const noHelmetCount =
        alerts.filter(
            a => a.violation === "No Helmet"
        ).length;


    const noMaskCount =
        alerts.filter(
            a => a.violation === "No Mask"
        ).length;


    const noVestCount =
        alerts.filter(
            a => a.violation === "No Safety Vest"
        ).length;


    const noGlovesCount =
        alerts.filter(
            a => a.violation === "No Gloves"
        ).length;


    return {

        ppeScore:
            Math.round(
                state.ppeScore || 0
            ),

        aiScore:
            Math.round(
                state.aiScore || 0
            ),

        totalViolations:
            alerts.length,

        duration:
            calculateMonitoringDuration(),

        noHelmet:
            noHelmetCount,

        noMask:
            noMaskCount,

        noVest:
            noVestCount,

        noGloves:
            noGlovesCount,

        alertHistory:
            alerts,

        generatedAt:
            new Date().toLocaleString()

    };

}


/* ============================================================
   PROFESSIONAL PDF
   ============================================================ */

function exportReportAsPDF() {

    if (!window.jspdf) {

        window.alert(
            "PDF library is not loaded."
        );

        return;

    }


    const {
        jsPDF
    } = window.jspdf;


    const doc =
        new jsPDF();


    const report =
        generateReportData();


    let y = 20;


    function checkPage(
        requiredHeight = 15
    ) {

        if (
            y + requiredHeight > 275
        ) {

            doc.addPage();

            y = 20;

            drawPageHeader();

        }

    }


    function drawPageHeader() {

        doc.setFontSize(9);

        doc.setTextColor(
            90,
            90,
            90
        );

        doc.text(
            "CONSTRUCTION WORKER SAFETY MONITORING SYSTEM",
            20,
            12
        );

        doc.setTextColor(
            0,
            0,
            0
        );

    }


    /* HEADER */

    drawPageHeader();


    doc.setFontSize(22);

    doc.setFont(undefined, "bold");

    doc.text(
        "CONSTRUCTION WORKER",
        20,
        y
    );

    y += 9;


    doc.text(
        "SAFETY MONITORING REPORT",
        20,
        y
    );

    y += 10;


    doc.setFont(undefined, "normal");

    doc.setFontSize(10);

    doc.text(
        "AI-Based PPE Compliance Monitoring System",
        20,
        y
    );

    y += 15;


    /* REPORT INFORMATION */

    doc.setFont(undefined, "bold");

    doc.setFontSize(13);

    doc.text(
        "REPORT INFORMATION",
        20,
        y
    );

    y += 8;


    doc.setFont(undefined, "normal");

    doc.setFontSize(10);


    doc.text(
        `Generated: ${report.generatedAt}`,
        20,
        y
    );

    y += 6;


    doc.text(
        `Monitoring Duration: ${report.duration}`,
        20,
        y
    );

    y += 12;


    /* SUMMARY */

    doc.setFont(undefined, "bold");

    doc.setFontSize(13);

    doc.text(
        "SAFETY SUMMARY",
        20,
        y
    );

    y += 9;


    doc.setFont(undefined, "normal");

    doc.setFontSize(11);


    doc.text(
        `PPE Compliance Score: ${report.ppeScore}%`,
        25,
        y
    );

    y += 7;


    doc.text(
        `AI Safety Score: ${report.aiScore}%`,
        25,
        y
    );

    y += 7;


    doc.text(
        `Total Violations: ${report.totalViolations}`,
        25,
        y
    );

    y += 12;


    /* BREAKDOWN */

    doc.setFont(undefined, "bold");

    doc.setFontSize(13);

    doc.text(
        "VIOLATION BREAKDOWN",
        20,
        y
    );

    y += 9;


    doc.setFont(undefined, "normal");

    doc.setFontSize(10);


    doc.text(
        `No Helmet: ${report.noHelmet}`,
        25,
        y
    );

    y += 6;


    doc.text(
        `No Mask: ${report.noMask}`,
        25,
        y
    );

    y += 6;


    doc.text(
        `No Safety Vest: ${report.noVest}`,
        25,
        y
    );

    y += 6;


    doc.text(
        `No Gloves: ${report.noGloves}`,
        25,
        y
    );

    y += 13;


    /* INCIDENTS */

    doc.setFont(undefined, "bold");

    doc.setFontSize(13);

    doc.text(
        "INCIDENT DETAILS",
        20,
        y
    );

    y += 10;


    if (
        report.alertHistory.length === 0
    ) {

        doc.setFont(undefined, "normal");

        doc.setFontSize(10);

        doc.text(
            "No safety incidents recorded.",
            25,
            y
        );

    } else {


        report.alertHistory.forEach(
            function (alert, index) {

                checkPage(55);


                const worker =
                    alert.worker_id !== null &&
                        alert.worker_id !== undefined

                        ? `Worker #${alert.worker_id}`

                        : "Worker #—";


                const violation =
                    alert.violation ||
                    "Safety Violation";


                const description =
                    violationSentence(
                        violation
                    );


                const confidence =
                    alert.confidence !== null &&
                        alert.confidence !== undefined

                        ? (
                            Number(
                                alert.confidence
                            ) * 100
                        ).toFixed(1) + "%"

                        : "N/A";


                doc.setFont(
                    undefined,
                    "bold"
                );

                doc.setFontSize(11);

                doc.text(
                    `${index + 1}. ${worker} — ${violation}`,
                    20,
                    y
                );

                y += 7;


                doc.setFont(
                    undefined,
                    "normal"
                );

                doc.setFontSize(9);


                const descriptionLines =
                    doc.splitTextToSize(
                        description,
                        165
                    );


                doc.text(
                    descriptionLines,
                    25,
                    y
                );


                y +=
                    descriptionLines.length * 5
                    + 3;


                doc.text(
                    `Incident Timestamp: ${alert.timestamp || "N/A"}`,
                    25,
                    y
                );

                y += 5;


                doc.text(
                    `Detection Confidence: ${confidence}`,
                    25,
                    y
                );

                y += 5;


                doc.text(
                    "Evidence: Captured violation frame",
                    25,
                    y
                );

                y += 9;


                doc.line(
                    20,
                    y,
                    190,
                    y
                );

                y += 9;

            }
        );

    }


    /* FOOTERS */

    const totalPages =
        doc.internal.getNumberOfPages();


    for (
        let page = 1;
        page <= totalPages;
        page++
    ) {

        doc.setPage(page);

        doc.setFont(undefined, "normal");

        doc.setFontSize(8);

        doc.setTextColor(
            100,
            100,
            100
        );


        doc.text(
            `Page ${page} of ${totalPages}`,
            165,
            287
        );


        doc.text(
            "Construction Worker Safety Monitoring System",
            20,
            287
        );


        doc.setTextColor(
            0,
            0,
            0
        );

    }


    doc.save(
        "Construction_Worker_Safety_Report.pdf"
    );

}


/* ============================================================
   IMPROVED CSV
   ============================================================ */

function exportReportAsCSV() {

    const report =
        generateReportData();


    function csvEscape(value) {

        return `"${String(
            value ?? ""
        ).replace(
            /"/g,
            '""'
        )}"`;

    }


    let csv =
        "Timestamp,Worker ID,Violation Type,Description,Confidence,Evidence\n";


    report.alertHistory.forEach(
        function (alert) {

            csv += [

                csvEscape(
                    alert.timestamp
                ),

                csvEscape(
                    alert.worker_id
                ),

                csvEscape(
                    alert.violation
                ),

                csvEscape(
                    violationSentence(
                        alert.violation
                    )
                ),

                csvEscape(
                    alert.confidence !== null &&
                        alert.confidence !== undefined

                        ? (
                            Number(
                                alert.confidence
                            ) * 100
                        ).toFixed(1) + "%"

                        : ""
                ),

                csvEscape(
                    alert.image_path
                )

            ].join(",");


            csv += "\n";

        }
    );


    const blob =
        new Blob(
            [csv],
            {
                type:
                    "text/csv;charset=utf-8;"
            }
        );


    downloadFile(
        blob,
        "Construction_Worker_Safety_Report.csv"
    );

}