Person ReID Test Data
====================

Place person images in each cam_X/ directory.
Images of the SAME person should appear in MULTIPLE camera directories
to test cross-camera re-identification.

Recommended naming: personID_description.jpg
Example: person01_front.jpg, person01_side.jpg

Each cam_X/ directory acts as a virtual camera view.
You can use images from public ReID datasets like:
  - Market-1501
  - DukeMTMC-reID
  - CHIRLA benchmark (46.75 MB, github.com/bdager/CHIRLA)
