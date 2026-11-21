from ultralytics import YOLO

model = YOLO("Construction-Site-Safety-30/runs/detect/train/weights/best.pt")

print(model.names)