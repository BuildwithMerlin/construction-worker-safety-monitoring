from ultralytics import YOLO
import cv2


class Detector:
    def __init__(self, model_path):
        self.model = YOLO(model_path)
        self.names = self.model.names

        print("MODEL CLASSES:")
        print(self.names)

        # Verify all expected PPE classes are present in the loaded model
        name_set = set(self.names.values())
        expected = {
            "Hardhat", "Mask", "Gloves", "Safety Vest",
            "NO-Hardhat", "NO-Mask", "NO-Safety Vest", "Person",
        }
        missing = expected - name_set
        if missing:
            print(f"WARNING: Expected classes not found in model: {missing}")
        else:
            print("All expected PPE/violation classes confirmed in model.")

        self.ppe_classes = {
            "Hardhat",
            "Mask",
            "Gloves",
            "Safety Vest",
        }

        self.violation_classes = {
            "NO-Hardhat",
            "NO-Mask",
            "NO-Safety Vest",
        }

        # Counter for persons that ByteTrack has not yet assigned an ID to.
        # Negative integers to distinguish from real track IDs.
        self._anon_counter = 0

    # ------------------------------------------------------------------
    # Spatial association helpers
    # ------------------------------------------------------------------

    def _intersection_over_ppe(self, ppe_box, person_box):
        """
        Compute intersection_area / ppe_box_area.

        Measures how much of the PPE bounding box overlaps the Person box.
        Using the (smaller) PPE area as denominator is far more robust than
        standard IoU because the Person box is typically 5-20x larger, which
        would make standard IoU tiny even for a well-placed hardhat.

        Returns a value in [0.0, 1.0].
        """
        px1, py1, px2, py2 = ppe_box
        wx1, wy1, wx2, wy2 = person_box

        ix1 = max(px1, wx1)
        iy1 = max(py1, wy1)
        ix2 = min(px2, wx2)
        iy2 = min(py2, wy2)

        if ix2 <= ix1 or iy2 <= iy1:
            return 0.0

        intersection = (ix2 - ix1) * (iy2 - iy1)
        ppe_area = max((px2 - px1) * (py2 - py1), 1)

        return intersection / ppe_area

    def _best_worker_for_ppe(self, ppe_box, workers, min_overlap=0.10):
        """
        Return the single worker whose Person bounding box has the highest
        overlap with `ppe_box`.

        min_overlap: minimum fraction of the PPE box that must overlap the
        Person box (default 10 %).  Rejects detections that barely graze a
        person.

        Returns the matching worker dict, or None.
        """
        best_worker = None
        best_score = min_overlap  # must beat this threshold to qualify

        for worker in workers:
            score = self._intersection_over_ppe(ppe_box, worker["bbox"])
            if score > best_score:
                best_score = score
                best_worker = worker

        return best_worker

    def detect(self, frame):
        """
        Run YOLO tracking on `frame`, associate PPE with workers, and return
        an annotated frame plus structured status data.

        PPE state per worker uses three values:
            True   — item explicitly detected by YOLO (confirmed present)
            False  — explicit NO-* class detected (confirmed missing)
            None   — not enough information (no detection either way)

        Worker safety status:
            "VIOLATION" — at least one explicit NO-* class detected
            "SAFE"      — no violations AND at least one PPE item confirmed
            "UNKNOWN"   — no explicit violations but no PPE confirmed either

        A detection failure is NOT automatically proof of a violation.

        Returns
        -------
        annotated_frame : np.ndarray
        detections : list[dict]  — raw per-box records
        worker_status : dict[int, dict]  — keyed by track_id
        """

        results = self.model.track(
            frame,
            conf=0.25,          # lowered from 0.50 — catches realistic webcam confidences
            persist=True,
            tracker="bytetrack.yaml",
            verbose=False,
        )

        annotated = frame.copy()
        detections = []

        # -------------------------------------------------
        # STEP 1: Collect all YOLO detections
        # -------------------------------------------------

        for result in results:

            if result.boxes is None:
                continue

            for box in result.boxes:

                cls = int(box.cls[0])
                conf = float(box.conf[0])

                x1, y1, x2, y2 = map(
                    int,
                    box.xyxy[0]
                )

                label = self.names[cls]

                track_id = None

                if box.id is not None:
                    track_id = int(box.id[0])

                detections.append({
                    "class_name": label,
                    "confidence": conf,
                    "bbox": [x1, y1, x2, y2],
                    "track_id": track_id
                })

        # ------------------------------------------------------------------
        # STEP 2: Build worker list
        # Person detections without a ByteTrack ID receive a temporary
        # negative anonymous ID so they are still evaluated this frame.
        # ------------------------------------------------------------------

        workers = []

        for det in detections:

            if det["class_name"] != "Person":
                continue

            tid = det["track_id"]
            if tid is None:
                # Assign a unique negative temporary ID for this frame
                self._anon_counter -= 1
                tid = self._anon_counter

            workers.append({
                "track_id": tid,
                "bbox": det["bbox"],
                # Three-state PPE flags — start as None (unknown)
                "helmet": None,
                "mask": None,
                "gloves": None,
                "vest": None,
                "violations": [],
            })

        # ------------------------------------------------------------------
        # STEP 3: Associate positive PPE detections with workers
        # Uses intersection/ppe_area overlap — robust to PPE boxes that
        # protrude slightly above or below the Person bounding box.
        # ------------------------------------------------------------------

        for det in detections:

            label = det["class_name"]
            if label not in self.ppe_classes:
                continue

            worker = self._best_worker_for_ppe(det["bbox"], workers)
            if worker is None:
                continue

            # Only upgrade from None → True.
            # Never overwrite an explicit False set by a NO-* detection.
            if label == "Hardhat" and worker["helmet"] is not False:
                worker["helmet"] = True

            elif label == "Mask" and worker["mask"] is not False:
                worker["mask"] = True

            elif label == "Gloves" and worker["gloves"] is not False:
                worker["gloves"] = True

            elif label == "Safety Vest" and worker["vest"] is not False:
                worker["vest"] = True

        # ------------------------------------------------------------------
        # STEP 4: Associate explicit NO-PPE detections with workers
        # These override positive detections (False wins over True/None).
        # ------------------------------------------------------------------

        for det in detections:

            label = det["class_name"]
            if label not in self.violation_classes:
                continue

            worker = self._best_worker_for_ppe(det["bbox"], workers)
            if worker is None:
                continue

            if label == "NO-Hardhat":
                worker["helmet"] = False
                if "No Helmet" not in worker["violations"]:
                    worker["violations"].append("No Helmet")

            elif label == "NO-Mask":
                worker["mask"] = False
                if "No Mask" not in worker["violations"]:
                    worker["violations"].append("No Mask")

            elif label == "NO-Safety Vest":
                worker["vest"] = False
                if "No Safety Vest" not in worker["violations"]:
                    worker["violations"].append("No Safety Vest")

        # ------------------------------------------------------------------
        # STEP 5: Determine per-worker safety status
        #
        # A detection failure is NOT proof of a violation.
        # Status is derived only from confirmed evidence:
        #   VIOLATION  — explicit NO-* class detected (False flag is set)
        #   SAFE       — no violations AND at least one PPE item confirmed
        #   UNKNOWN    — no explicit violations, but no PPE confirmed either
        # ------------------------------------------------------------------

        worker_status = {}

        for worker in workers:

            has_violations = len(worker["violations"]) > 0

            ppe_confirmed = (
                worker["helmet"] is True
                or worker["mask"] is True
                or worker["vest"] is True
                or worker["gloves"] is True
            )

            if has_violations:
                status = "VIOLATION"
            elif ppe_confirmed:
                status = "SAFE"
            else:
                status = "UNKNOWN"

            worker_status[worker["track_id"]] = {
                "status": status,
                "violations": list(worker["violations"]),
                "ppe": {
                    # True / False / None — three-state, preserved for UI
                    "Hardhat": worker["helmet"],
                    "Mask": worker["mask"],
                    "Gloves": worker["gloves"],
                    "Safety Vest": worker["vest"],
                },
            }

        # ------------------------------------------------------------------
        # STEP 6: Draw detections on annotated frame
        # ------------------------------------------------------------------

        for det in detections:

            label = det["class_name"]
            conf = det["confidence"]
            x1, y1, x2, y2 = det["bbox"]
            track_id = det["track_id"]

            if label in self.violation_classes:
                color = (0, 0, 255)         # Red

            elif label in self.ppe_classes:
                color = (0, 255, 0)         # Green

            elif label == "Person":
                color = (255, 180, 0)       # Orange (BGR)

            else:
                color = (150, 150, 150)     # Grey for non-PPE classes

            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            if label == "Person" and track_id is not None and track_id > 0:
                display_label = f"Worker {track_id} {conf:.2f}"
            elif label == "Person":
                display_label = f"Worker ??? {conf:.2f}"
            else:
                display_label = f"{label} {conf:.2f}"

            cv2.putText(
                annotated,
                display_label,
                (x1, max(y1 - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
            )

        # ------------------------------------------------------------------
        # STEP 7: Draw per-worker safety status overlay (top-left corner)
        # ------------------------------------------------------------------

        y_pos = 30

        for tid, ws in worker_status.items():

            label_prefix = f"W{tid:03d}" if tid > 0 else "W???"
            text = f"{label_prefix}: {ws['status']}"

            if ws["status"] == "SAFE":
                status_color = (0, 255, 0)      # Green
            elif ws["status"] == "VIOLATION":
                status_color = (0, 0, 255)      # Red
            else:
                status_color = (0, 165, 255)    # Orange for UNKNOWN

            cv2.putText(
                annotated,
                text,
                (10, y_pos),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                status_color,
                2,
            )

            y_pos += 30

        return annotated, detections, worker_status