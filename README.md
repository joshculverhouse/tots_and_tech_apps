# Height and Weight PID converter (webR)

This is a static browser application intended for Chrome or Edge. It runs R in the browser with webR and uses Chrome's File System Access API to read and write a locally synced OneDrive project folder.

## Safety behavior

- Source files are read only; they are never edited, renamed, moved, or deleted.
- Output is written only to `Participant Tracking/Mid Assessment Data Checks/Height and Weight/check_ht_wt (COHORT_ASSESSMENT)`.
- A missing output folder is created only after all validation checks pass.
- An existing empty output folder is allowed.
- If the output folder contains any file or subfolder, the run stops before copying.
- If copying fails after it begins, the app attempts to remove all files created during that run.
- HEIC files are copied unchanged and retain the `.heic` extension.
- Unmatched files are copied with their original filenames. Duplicate output names receive `_dupe_1`, `_dupe_2`, and so on.

## GitHub Pages deployment

Copy `index.html`, `app.js`, `analysis.R`, and `styles.css` into the folder GitHub Pages publishes (commonly `docs/`). Commit and push the files.

The page must be opened over HTTPS in Chrome or Edge. The OneDrive folder must be synced to the local computer and available offline.

## Expected project structure

```text
R01 - Tots & Tech 2.0/
└── Participant Tracking/
    ├── R01 T&T Master Tracking.xlsx
    └── Mid Assessment Data Checks/
        └── Height and Weight/
            ├── Height+and+Weight....sav
            └── Images/
                ├── 1_height_pic/
                ├── 2_height_pic/
                ├── 3_height_pic/
                ├── 1_weight_pic/
                ├── 2_weight_pic/
                └── 3_weight_pic/
```

The tracking workbook must contain `Cohort` and `WDID`. The SPSS file must contain `cid`, `StartDate`, `ResponseId`, and the six expected picture-name variables.
