import os
import cv2
import time
import sqlite3
import threading
from datetime import datetime
from functools import wraps

from flask import (
    Flask,
    render_template,
    Response,
    jsonify,
    send_from_directory,
    abort,
    request,
    redirect,
    url_for,
    session,
)

from werkzeug.security import generate_password_hash, check_password_hash

from detector import Detector


# ============================================================
# VOICE ALERT
# ============================================================

try:
    from playsound import playsound
except ImportError:
    print(
        "Playsound not found. Voice alerts will be disabled."
    )
    playsound = None


# ============================================================
# FLASK APPLICATION
# ============================================================

app = Flask(__name__)

app.secret_key = os.environ.get(
    "SECRET_KEY",
    "construction-safety-secret-key"
)


# ============================================================
# CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

MODEL_PATH = os.path.join(
    BASE_DIR,
    "Construction-Site-Safety-30",
    "runs",
    "detect",
    "train",
    "weights",
    "best.pt"
)

# If the normal path does not exist, search for best.pt
if not os.path.isfile(MODEL_PATH):

    for root, dirs, files in os.walk(BASE_DIR):

        if "best.pt" in files:

            MODEL_PATH = os.path.join(
                root,
                "best.pt"
            )

            break


VIOLATIONS_DIR = os.path.join(
    BASE_DIR,
    "violations"
)

DB_PATH = os.path.join(
    BASE_DIR,
    "violations.db"
)

VOICE_ALERTS_ENABLED = (
    True if playsound else False
)

VOICE_ALERT_FILE = os.path.join(
    BASE_DIR,
    "static",
    "alert.mp3"
)


# Create violations folder
os.makedirs(
    VIOLATIONS_DIR,
    exist_ok=True
)


# ============================================================
# MODEL
# ============================================================

if not os.path.isfile(MODEL_PATH):

    raise FileNotFoundError(
        "\n\nCUSTOM YOLO MODEL NOT FOUND!\n"
        "Please make sure your trained best.pt exists.\n\n"
        "Expected location:\n"
        "Construction-Site-Safety-30/"
        "runs/detect/train/weights/best.pt\n\n"
        "Do NOT rename yolov8n.pt to best.pt.\n"
    )


print("")
print("==============================================")
print("Loading Construction Safety YOLO Model")
print("==============================================")
print(MODEL_PATH)
print("")


detector = Detector(
    model_path=MODEL_PATH
)


# ============================================================
# GLOBAL VARIABLES
# ============================================================

current_frame = None

current_worker_status = {}

ppe_compliance_score = 100

ai_safety_score = 100

alert_history = []


# Dashboard statistics

total_persons = 0

helmets_count = 0

masks_count = 0

vests_count = 0

gloves_count = 0


# Alert cooldown

last_alert_time = time.time()

ALERT_COOLDOWN = 5


# Thread locks

frame_lock = threading.Lock()

data_lock = threading.Lock()


# ============================================================
# DATABASE
# ============================================================

def get_db_connection():

    conn = sqlite3.connect(
        DB_PATH
    )

    conn.row_factory = sqlite3.Row

    return conn


def init_db():

    conn = get_db_connection()

    try:

        # ----------------------------------------------------
        # Violations
        # ----------------------------------------------------

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS violations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                worker_id INTEGER,
                violation_type TEXT NOT NULL,
                confidence REAL,
                screenshot_path TEXT
            )
            """
        )


        # ----------------------------------------------------
        # Users
        # ----------------------------------------------------

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )


        # ----------------------------------------------------
        # Default admin account
        # ----------------------------------------------------

        existing_user = conn.execute(
            """
            SELECT id
            FROM users
            WHERE username = ?
            """,
            ("admin",)
        ).fetchone()


        if existing_user is None:

            password_hash = (
                generate_password_hash(
                    "admin123"
                )
            )

            conn.execute(
                """
                INSERT INTO users
                (
                    username,
                    password_hash,
                    created_at
                )
                VALUES (?, ?, ?)
                """,
                (
                    "admin",
                    password_hash,
                    datetime.now().strftime(
                        "%Y-%m-%d %H:%M:%S"
                    ),
                ),
            )

            print(
                "Default admin account created."
            )


        conn.commit()

    finally:

        conn.close()


# ============================================================
# USER AUTHENTICATION
# ============================================================

def authenticate_user(
    username,
    password
):

    conn = get_db_connection()

    try:

        user = conn.execute(
            """
            SELECT
                id,
                username,
                password_hash
            FROM users
            WHERE username = ?
            """,
            (username,)
        ).fetchone()


        if user is None:

            return None


        if check_password_hash(
            user["password_hash"],
            password
        ):

            return {
                "id": user["id"],
                "username": user["username"]
            }


        return None

    finally:

        conn.close()


# ============================================================
# LOGIN REQUIRED
# ============================================================

def login_required(view):

    @wraps(view)
    def wrapped(*args, **kwargs):

        if "user_id" not in session:

            if request.path == "/":

                return redirect(
                    url_for("login")
                )

            return jsonify({
                "success": False,
                "error": "Authentication required"
            }), 401

        return view(
            *args,
            **kwargs
        )

    return wrapped


# ============================================================
# VIOLATION DATABASE FUNCTIONS
# ============================================================

def insert_violation(
    timestamp,
    worker_id,
    violation_type,
    confidence,
    screenshot_path
):

    conn = get_db_connection()

    try:

        conn.execute(
            """
            INSERT INTO violations (
                timestamp,
                worker_id,
                violation_type,
                confidence,
                screenshot_path
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                timestamp,
                worker_id,
                violation_type,
                confidence,
                screenshot_path,
            ),
        )

        conn.commit()

    finally:

        conn.close()


def screenshot_url(stored_path):

    if not stored_path:

        return ""

    filename = os.path.basename(
        stored_path
    )

    return (
        f"/violations/{filename}"
    )


def load_recent_violations(
    limit=50
):

    conn = get_db_connection()

    try:

        rows = conn.execute(
            """
            SELECT
                timestamp,
                worker_id,
                violation_type,
                confidence,
                screenshot_path
            FROM violations
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()


        history = []


        for row in rows:

            history.append({

                "timestamp":
                    row["timestamp"],

                "violation":
                    row["violation_type"],

                "image_path":
                    screenshot_url(
                        row["screenshot_path"]
                    ),

                "worker_id":
                    row["worker_id"],

                "confidence":
                    row["confidence"],
            })


        return history

    finally:

        conn.close()


def clear_violations():

    conn = get_db_connection()

    try:

        cursor = conn.execute(
            "DELETE FROM violations"
        )

        conn.commit()

        return cursor.rowcount

    finally:

        conn.close()


# ============================================================
# SAFETY SCORING
# ============================================================

VIOLATION_PENALTIES = {

    "No Helmet": 25,

    "No Mask": 15,

    "No Safety Vest": 20,

}


def _unique_violations(
    violations
):

    unique = []


    for violation in (
        violations or []
    ):

        if violation not in unique:

            unique.append(
                violation
            )


    return unique


def calculate_worker_safety_score(
    worker
):

    status = worker.get(
        "status"
    )


    if status == "SAFE":

        return 100.0


    if status == "UNKNOWN":

        return 75.0


    score = 100.0


    for violation in _unique_violations(
        worker.get(
            "violations",
            []
        )
    ):

        score -= VIOLATION_PENALTIES.get(
            violation,
            0
        )


    return max(
        0.0,
        min(
            100.0,
            score
        )
    )


def calculate_ppe_compliance(
    worker_status
):

    total_workers = len(
        worker_status
    )


    if total_workers == 0:

        return 100.0, []


    compliant_workers = sum(

        1

        for worker
        in worker_status.values()

        if worker["status"] == "SAFE"

    )


    score = (
        compliant_workers
        / total_workers
    ) * 100.0


    score = max(
        0.0,
        min(
            100.0,
            score
        )
    )


    violation_list = []


    for worker in (
        worker_status.values()
    ):

        if worker["status"] != "VIOLATION":

            continue


        for violation in _unique_violations(
            worker.get(
                "violations",
                []
            )
        ):

            if violation not in violation_list:

                violation_list.append(
                    violation
                )


    return score, violation_list


def calculate_ai_safety_score(
    worker_status
):

    if not worker_status:

        return 100.0


    total = 0.0


    for worker in (
        worker_status.values()
    ):

        total += (
            calculate_worker_safety_score(
                worker
            )
        )


    average = (
        total
        / len(worker_status)
    )


    return max(
        0.0,
        min(
            100.0,
            round(
                average,
                2
            )
        )
    )


# ============================================================
# VIOLATION COLLECTION
# ============================================================

def collect_frame_violations(
    worker_status
):

    violations = []


    for worker in (
        worker_status.values()
    ):

        for violation in worker[
            "violations"
        ]:

            if violation not in violations:

                violations.append(
                    violation
                )


    return violations


def collect_frame_violation_events(
    worker_status,
    detections
):

    confidence_by_worker = {}


    for det in detections:

        if (
            det["class_name"]
            == "Person"
            and
            det["track_id"]
            is not None
        ):

            confidence_by_worker[
                det["track_id"]
            ] = det["confidence"]


    events = []


    for (
        worker_id,
        worker
    ) in worker_status.items():

        if worker["status"] != "VIOLATION":

            continue


        for violation_type in worker[
            "violations"
        ]:

            events.append({

                "worker_id":
                    worker_id,

                "violation_type":
                    violation_type,

                "confidence":
                    confidence_by_worker.get(
                        worker_id
                    ),
            })


    return events


# ============================================================
# VOICE ALERT
# ============================================================

def play_voice_alert(
    violation_type
):

    if (
        VOICE_ALERTS_ENABLED
        and
        os.path.exists(
            VOICE_ALERT_FILE
        )
    ):

        print(
            f"Playing voice alert for: "
            f"{violation_type}"
        )


        threading.Thread(
            target=playsound,
            args=(
                VOICE_ALERT_FILE,
            ),
            daemon=True
        ).start()

    else:

        print(
            "Voice alert file not found "
            "or playsound disabled."
        )


# ============================================================
# SCREENSHOT
# ============================================================

def capture_screenshot(
    frame,
    violation_type
):

    timestamp = datetime.now().strftime(
        "%Y%m%d_%H%M%S"
    )


    safe_type = (
        violation_type
        .replace(" ", "_")
    )


    filename = (
        f"{safe_type}_"
        f"{timestamp}.jpg"
    )


    filepath = os.path.join(
        VIOLATIONS_DIR,
        filename
    )


    cv2.imwrite(
        filepath,
        frame
    )


    print(
        f"Screenshot saved: "
        f"{filepath}"
    )


    return filepath


# ============================================================
# VIDEO PROCESSING THREAD
# ============================================================

def video_processing_thread():

    global current_frame
    global current_worker_status
    global ppe_compliance_score
    global ai_safety_score
    global alert_history
    global last_alert_time

    global total_persons
    global helmets_count
    global masks_count
    global vests_count
    global gloves_count


    cap = cv2.VideoCapture(0)


    if not cap.isOpened():

        print(
            "Error: Could not open video "
            "stream. Retrying in 5 seconds..."
        )

        time.sleep(5)

        cap = cv2.VideoCapture(0)


        if not cap.isOpened():

            print(
                "Error: Camera unavailable. "
                "Video thread exiting."
            )

            return


    print(
        "Video capture started successfully."
    )


    while True:

        try:

            ret, frame = cap.read()


            if not ret:

                print(
                    "Warning: Failed to grab "
                    "frame, attempting to "
                    "reopen camera..."
                )


                cap.release()

                time.sleep(1)

                cap = cv2.VideoCapture(0)


                if not cap.isOpened():

                    print(
                        "Error: Could not "
                        "reopen camera. "
                        "Stopping thread."
                    )

                    break


                continue


            # =================================================
            # ORIGINAL DETECTOR PIPELINE
            # DO NOT CHANGE THIS
            # =================================================

            (
                annotated_frame,
                detections,
                worker_status
            ) = detector.detect(frame)


            # =================================================
            # DASHBOARD COUNTS
            # =================================================

            total_persons = len(
                worker_status
            )


            helmets_count = 0

            masks_count = 0

            vests_count = 0

            gloves_count = 0


            for det in detections:

                label = det[
                    "class_name"
                ]


                if label == "Hardhat":

                    helmets_count += 1


                elif label == "Mask":

                    masks_count += 1


                elif label == "Safety Vest":

                    vests_count += 1


                elif label == "Gloves":

                    gloves_count += 1


            # =================================================
            # SCORES + ALERTS
            # =================================================

            with data_lock:

                current_worker_status = (
                    worker_status
                )


                ppe_compliance_score, _ = (
                    calculate_ppe_compliance(
                        worker_status
                    )
                )


                ai_safety_score = (
                    calculate_ai_safety_score(
                        worker_status
                    )
                )


                current_time = time.time()


                violation_events = (
                    collect_frame_violation_events(
                        worker_status,
                        detections
                    )
                )

                for event in violation_events:
                    if current_time - last_alert_time > ALERT_COOLDOWN:
                        violation = event["violation_type"]
                        print(f"Violation detected: {violation}")

                        screenshot_path = capture_screenshot(frame, violation)

                        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                        insert_violation(
                            timestamp=timestamp,
                            worker_id=event["worker_id"],
                            violation_type=violation,
                            confidence=event["confidence"],
                            screenshot_path=screenshot_path,
                        )

                        alert_entry = {
                            "timestamp": timestamp,
                            "violation": violation,
                            "image_path": screenshot_url(screenshot_path),
                            "worker_id": event["worker_id"],
                            "confidence": event["confidence"],
                        }

                        alert_history.insert(0, alert_entry)

                        if len(alert_history) > 50:
                            alert_history.pop()

                        play_voice_alert(violation)

                        last_alert_time = current_time

            # =================================================
            # SAVE ANNOTATED FRAME
            # =================================================

            with frame_lock:

                current_frame = (
                    annotated_frame.copy()
                )


            time.sleep(0.03)


        except Exception as e:

            print(
                f"Error in video processing: "
                f"{e}"
            )

            time.sleep(0.1)


    cap.release()


# ============================================================
# INITIALIZE DATABASE
# ============================================================

init_db()

alert_history = (
    load_recent_violations()
)


# ============================================================
# LOGIN ROUTE
# ============================================================

@app.route(
    "/login",
    methods=["GET", "POST"]
)
def login():

    # Already logged in
    if "user_id" in session:

        return redirect(
            url_for("index")
        )


    error = None


    if request.method == "POST":

        username = request.form.get(
            "username",
            ""
        ).strip()


        password = request.form.get(
            "password",
            ""
        )


        if not username or not password:

            error = (
                "Please enter username "
                "and password."
            )

        else:

            user = authenticate_user(
                username,
                password
            )


            if user:

                session["user_id"] = (
                    user["id"]
                )

                session["username"] = (
                    user["username"]
                )


                return redirect(
                    url_for("index")
                )


            error = (
                "Invalid username or password."
            )


    return render_template(
        "login.html",
        error=error
    )


# ============================================================
# LOGOUT
# ============================================================

@app.route("/logout")
def logout():

    session.clear()

    return redirect(
        url_for("login")
    )
 # ============================================================
# SIGN UP
# ============================================================

@app.route('/signup', methods=['GET', 'POST'])
def signup():

    if 'user_id' in session:
        return redirect(url_for('index'))

    error = None

    if request.method == 'POST':

        username = request.form.get(
            'username',
            ''
        ).strip()

        password = request.form.get(
            'password',
            ''
        )

        confirm_password = request.form.get(
            'confirm_password',
            ''
        )

        # Validate username
        if not username or not password:

            error = "Please fill in all fields."

        elif len(username) < 3:

            error = "Username must contain at least 3 characters."

        elif len(password) < 6:

            error = "Password must contain at least 6 characters."

        elif password != confirm_password:

            error = "Passwords do not match."

        else:

            conn = get_db_connection()

            try:

                existing = conn.execute(
                    """
                    SELECT id
                    FROM users
                    WHERE username = ?
                    """,
                    (username,)
                ).fetchone()

                if existing:

                    error = "Username already exists."

                else:

                    password_hash = generate_password_hash(
                        password
                    )

                    cursor = conn.execute(
                        """
                        INSERT INTO users
                        (
                            username,
                            password_hash,
                            created_at
                        )
                        VALUES (?, ?, ?)
                        """,
                        (
                            username,
                            password_hash,
                            datetime.now().strftime(
                                "%Y-%m-%d %H:%M:%S"
                            ),
                        ),
                    )

                    conn.commit()

                    # Automatically log the new user in
                    session.clear()

                    session['user_id'] = cursor.lastrowid

                    session['username'] = username

                    return redirect(
                        url_for('index')
                    )

            finally:

                conn.close()

    return render_template(
        'signup.html',
        error=error
    )   


# ============================================================
# MAIN DASHBOARD
# ============================================================

@app.route("/")
@login_required
def index():

    return render_template(
        "index.html"
    )


# ============================================================
# VIDEO STREAM
# ============================================================

def generate_frames():

    global current_frame


    while True:

        with frame_lock:

            frame = current_frame


        if frame is None:

            time.sleep(0.05)

            continue


        ret, buffer = cv2.imencode(
            ".jpg",
            frame
        )


        if not ret:

            time.sleep(0.05)

            continue


        frame_bytes = (
            buffer.tobytes()
        )


        yield (
            b"--frame\n"
            b"Content-Type: image/jpeg\n\n"
            + frame_bytes
            + b"\n"
        )


        time.sleep(0.03)


@app.route("/video_feed")
@login_required
def video_feed():

    return Response(

        generate_frames(),

        mimetype=(
            "multipart/x-mixed-replace; "
            "boundary=frame"
        )

    )


# ============================================================
# VIOLATION SCREENSHOTS
# ============================================================

@app.route(
    "/violations/<path:filename>"
)
@login_required
def serve_violation_screenshot(
    filename
):

    if (
        os.path.basename(filename)
        != filename
    ):

        abort(404)


    return send_from_directory(

        os.path.abspath(
            VIOLATIONS_DIR
        ),

        filename

    )


# ============================================================
# DATA FEED
# ============================================================

@app.route("/data_feed")
@login_required
def data_feed():

    global ppe_compliance_score
    global ai_safety_score
    global alert_history
    global current_worker_status

    global total_persons
    global helmets_count
    global masks_count
    global vests_count
    global gloves_count


    with data_lock:

        worker_status_json = {

            str(worker_id):
                worker

            for (
                worker_id,
                worker
            )
            in current_worker_status.items()

        }


        data = {

            "ppe_compliance_score":
                ppe_compliance_score,

            "ai_safety_score":
                ai_safety_score,

            "alert_history":
                alert_history,

            "worker_status":
                worker_status_json,

            "total_persons":
                total_persons,

            "helmets_count":
                helmets_count,

            "masks_count":
                masks_count,

            "vests_count":
                vests_count,

            "gloves_count":
                gloves_count,

            "username":
                session.get(
                    "username"
                ),

        }


    return jsonify(data)


# ============================================================
# CLEAR ALERTS
# ============================================================

@app.route(
    "/clear_alerts",
    methods=["POST"]
)
@login_required
def clear_alerts():

    global alert_history


    with data_lock:

        deleted = (
            clear_violations()
        )

        alert_history = []


    return jsonify({

        "success": True,

        "cleared":
            deleted,

    })


# ============================================================
# START APPLICATION
# ============================================================

if __name__ == "__main__":

    processing_thread = (
        threading.Thread(
            target=video_processing_thread,
            daemon=True
        )
    )


    processing_thread.start()


    print("")
    print("==============================================")
    print(" CONSTRUCTION WORKER SAFETY MONITORING SYSTEM")
    print("==============================================")
    print("")
    print("LOGIN")
    print("Username : admin")
    print("Password : admin123")
    print("")
    print(
        "Open http://127.0.0.1:5000"
    )
    print("")


    app.run(
        host="0.0.0.0",
        port=5000,
        debug=False
    )