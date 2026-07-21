# ===============================================================================
# Script Name: convert_ht_wt_to_pid_v5.R
# Description: Relabel height and weight images with participant ids to allow
#              checks for errors, copying and renaming images without overwriting
# Author: Josh Culverhouse
# Date: 2025-05-09
# ===============================================================================

# ----------------------------- CONFIGURATION ----------------------------------

# +-+-+-+-+ +-+-+-+-+ +-+-+-+ #
# |E|d|i|t| |t|h|i|s| |b|i|t| #

# cohort     <- "E"      # Cohort identifier, e.g., "A", "B", "C", "D"
# assessment <- "A6"    # Assessment label, e.g., "A1", "A6", "A12"
# # # # # your filepath to "R01 - Tots & Tech 2.0" folder
# base_path  <- "C:/Users/culverhj/OneDrive - University of South Carolina/R01 - Tots & Tech 2.0/"
# +-+-+-+-+ +-+-+-+-+ +-+-+-+ #


# ------------------------------ SETUP -----------------------------------------
library(pacman)
p_load(readxl, haven, tidyverse, fs, lubridate, glue
       # magick
       )

# ------------------------------- PATHS ----------------------------------------
tracking_file     <- file.path(base_path, "Participant Tracking", "R01 T&T Master Tracking.xlsx")
handw_spss_dir    <- file.path(base_path, "Participant Tracking", "Mid Assessment Data Checks", "Height and Weight")
handw_images_root <- handw_spss_dir
output_dir        <- file.path(handw_images_root, paste0("check_ht_wt (", cohort, "_", assessment, ")"))

# ----------------------------- VALIDATIONS ------------------------------------
# Prevent overwriting existing output
if (dir_exists(output_dir) && length(dir_ls(output_dir, recurse = TRUE)) > 0) {
  print(paste("Output directory", output_dir, "already exists and contains files.",
              "Have you changed cohort and assessment above? If yes, check that this folder",
              output_dir, "and remove/move to 'old' and retry."))
  stop(print("See above"))
}

# Load Master Tracking with helpful error message
tracking <- tryCatch(
  {
    read_excel(tracking_file, sheet = 1)
  },
  error = function(e) {
    message("The Master Tracking sheet might be open elsewhere. Please close it and rerun.")
    stop(e)
  }
)

# Filter PIDs for specified cohort and assessment
filtered_pids <- tracking %>%
  # filter(Cohort == cohort) %>%
  pull(WDID)
if (length(filtered_pids) == 0) {
  stop(glue("No participants found for Cohort '{cohort}' and Assessment '{assessment}' in tracking sheet."))
}

# ---------------------------- DATA WRANGLING ----------------------------------
# Locate and read the .sav file
sav_files <- dir_ls(handw_spss_dir, glob = "*.sav")
sav_match <- sav_files[str_detect(basename(sav_files), "^Height\\+and\\+Weight")]
if (length(sav_match) == 0) stop("No 'Height+and+Weight' .sav file found.")
if (length(sav_match) > 1)  stop("Multiple 'Height+and+Weight' .sav files found. Keep only the latest.")
handw <- read_sav(sav_match) %>%
  filter(cid %in% filtered_pids) %>%
  mutate(
    StartDate = as_date(StartDate),
    pid_date  = paste(cid, StartDate, sep = "_"),
    across(ends_with("_pic_Name"),
           ~ paste(ResponseId, ., sep = "_"),
           .names = "{sub('_pic_Name', '_filename', .col)}")
  ) %>%
  # NEW: trim any padding/whitespace in the constructed filenames
  mutate(across(ends_with("_filename"), ~ stringr::str_trim(.))) %>%
  select(pid_date, ends_with("_filename"))


# ------------------------ IMAGE FOLDER PREPARATION -----------------------------
# Find main images folder and subfolders
ht_wt_folder <- dir_ls(handw_images_root, type = "directory") %>% str_subset("Images")
if (length(ht_wt_folder) != 1) stop("Expected exactly one 'Images' folder.")
subfolders <- file.path(ht_wt_folder, c("1_height_pic","2_height_pic","3_height_pic",
                                        "1_weight_pic","2_weight_pic","3_weight_pic"))
if (!all(dir_exists(subfolders))) stop("Missing expected subfolders. Check directory structure.")

# Gather image files
image_files <- dir_ls(subfolders, recurse = TRUE) %>%
  str_subset("(?i)\\.(jpe?g|png|heic|mov)$")
message(glue("Total source files: {length(image_files)}"))

# Build expected filenames list from handw
expected_files <- handw %>% select(ends_with("_filename")) %>% unlist(use.names = FALSE)
message(glue("Expected images based on data (inflated due to incomplete attemps at H&W survey): {length(expected_files)}"))

# Identify missing expected images
missing_expected <- setdiff(expected_files, basename(image_files))
if (length(missing_expected) > 0) {
  message(glue("Missing {length(missing_expected)} expected images (no source file found) (IGNORE - INCOMPLETE SURVEY SUBMISSIONS):"))
  walk(missing_expected, ~ message(" - ", .x))
}

# Create output directory
dir_create(output_dir)

# --------------------------- PROCESS IMAGES -----------------------------------

# initialize counters & containers
unmatched    <- character()
copied_count <- 0L

# Magick-based HEIC to JPEG conversion happens in the block below
copy_and_rename <- function(src, info_df, dest_dir) {
  orig_name <- basename(src)
  ext_orig  <- tolower(tools::file_ext(orig_name))
  
  # Match filename to data ignoring extension case
  strip_ext <- function(x) tolower(tools::file_path_sans_ext(stringr::str_trim(x)))
  
  matched <- info_df %>%
    mutate(across(ends_with("_filename"), strip_ext, .names = "{.col}_stem")) %>%
    filter(if_any(ends_with("_stem"), ~ . == strip_ext(orig_name)))
  
  
  if (nrow(matched) == 0) {
    # no data match → copy as-is so it surfaces for manual review
    tryCatch(
      file_copy(src, file.path(dest_dir, orig_name)),
      error = function(e) {
        warning(glue("Failed to copy unmatched {orig_name}: {e$message}"))
      }
    )
    unmatched <<- c(unmatched, orig_name)
    return(invisible(NULL))
  }
  
  # Determine suffix based on column
  suffix <- case_when(
    matched$A1_height_filename == orig_name ~ "height_1",
    matched$A2_height_filename == orig_name ~ "height_2",
    matched$A3_height_filename == orig_name ~ "height_3",
    matched$A1_weight_filename == orig_name ~ "weight_1",
    matched$A2_weight_filename == orig_name ~ "weight_2",
    matched$A3_weight_filename == orig_name ~ "weight_3",
    TRUE                                   ~ "unknown"
  )
  
  # Build new filename base
  base <- paste0(matched$pid_date, "_", suffix) %>%
    str_replace_all(":", "-")
  
  # # Determine target extension
  # ext_target <- if (ext_orig == "heic") "jpg" else ext_orig
  ext_target <- ext_orig
  
  
  new_name   <- paste0(base, ".", ext_target)
  new_path   <- file.path(dest_dir, new_name)
  counter    <- 1
  
  while (file_exists(new_path)) {
    new_name <- paste0(base, "_dupe_", counter, ".", ext_target)
    new_path <- file.path(dest_dir, new_name)
    counter  <- counter + 1
  }
  
  # Copy/convert with error‐capture
  tryCatch({
    # if (ext_orig == "heic") {
    #   img <- image_read(src)
    #   image_write(img, path = new_path, format = "jpeg")
    # } else {
    #   file_copy(src, new_path)
    # }
    file_copy(src, new_path)
    copied_count <<- copied_count + 1L
  }, error = function(e) {
    warning(glue("Failed to copy {orig_name} → {basename(new_path)}: {e$message}"))
    unmatched <<- c(unmatched, orig_name)
  })
}

# Run over all image files
walk(image_files, ~ copy_and_rename(.x, handw, output_dir))

# ------------------------ SUMMARY OF RESULTS ----------------------------------

message(glue("{copied_count} files successfully copied/renamed."))

if (length(unmatched) > 0) {
  message(glue("{length(unmatched)} files unmatched (copied with original names) - DON'T FORGET TO SHORTEN THE NAME OF THE HEIGHT AND WEIGHT IMAGES FOLDER!!!!!!:"))
  walk(
    unmatched,
    ~ message(" - ", .x)
  )
} else {
  message("All files matched and renamed!\nGood job!")
}
