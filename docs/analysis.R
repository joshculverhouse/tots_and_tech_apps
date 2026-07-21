# Browser-side R logic for the Height & Weight image conversion app.
# File access and copying are performed by JavaScript. This function reads the
# temporary workbook and SPSS file and returns a filename-renaming manifest.

normalise_text <- function(x) {
  if (inherits(x, "haven_labelled")) {
    x <- haven::zap_labels(x)
  }
  trimws(as.character(x))
}

build_manifest <- function(tracking_path, sav_path, cohort) {
  tracking <- tryCatch(
    readxl::read_excel(tracking_path, sheet = 1),
    error = function(e) {
      stop(
        "Could not read 'R01 T&T Master Tracking.xlsx'. ",
        "Make sure the workbook is valid and fully available offline. Details: ",
        conditionMessage(e),
        call. = FALSE
      )
    }
  )

  required_tracking <- c("Cohort", "WDID")
  missing_tracking <- setdiff(required_tracking, names(tracking))
  if (length(missing_tracking) > 0) {
    stop(
      "The tracking workbook is missing required column(s): ",
      paste(missing_tracking, collapse = ", "),
      call. = FALSE
    )
  }

  cohort_values <- toupper(normalise_text(tracking$Cohort))
  filtered_pids <- unique(normalise_text(tracking$WDID[cohort_values == toupper(cohort)]))
  filtered_pids <- filtered_pids[!is.na(filtered_pids) & nzchar(filtered_pids)]

  if (length(filtered_pids) == 0) {
    stop(
      sprintf("No participants were found for Cohort '%s' in the tracking workbook.", cohort),
      call. = FALSE
    )
  }

  handw <- tryCatch(
    haven::read_sav(sav_path),
    error = function(e) {
      stop(
        "Could not read the Height+and+Weight .sav file. ",
        "Make sure it is a valid SPSS file and fully available offline. Details: ",
        conditionMessage(e),
        call. = FALSE
      )
    }
  )

  photo_cols <- c(
    "A1_height_pic_Name", "A2_height_pic_Name", "A3_height_pic_Name",
    "A1_weight_pic_Name", "A2_weight_pic_Name", "A3_weight_pic_Name"
  )
  suffixes <- c("height_1", "height_2", "height_3", "weight_1", "weight_2", "weight_3")

  required_sav <- c("cid", "StartDate", "ResponseId", photo_cols)
  missing_sav <- setdiff(required_sav, names(handw))
  if (length(missing_sav) > 0) {
    stop(
      "The .sav file is missing required variable(s): ",
      paste(missing_sav, collapse = ", "),
      call. = FALSE
    )
  }

  cid <- normalise_text(handw$cid)
  keep <- cid %in% filtered_pids
  handw <- handw[keep, , drop = FALSE]
  cid <- cid[keep]

  if (nrow(handw) == 0) {
    stop(
      sprintf(
        "The .sav file contains no records matching participants in Cohort '%s'.",
        cohort
      ),
      call. = FALSE
    )
  }

  start_date <- suppressWarnings(as.Date(handw$StartDate))
  if (any(is.na(start_date))) {
    stop(
      sprintf(
        "%s matching survey record(s) have a missing or unreadable StartDate.",
        sum(is.na(start_date))
      ),
      call. = FALSE
    )
  }

  response_id <- normalise_text(handw$ResponseId)
  if (any(is.na(response_id) | !nzchar(response_id))) {
    stop(
      sprintf(
        "%s matching survey record(s) have a missing ResponseId.",
        sum(is.na(response_id) | !nzchar(response_id))
      ),
      call. = FALSE
    )
  }

  pid_date <- paste(cid, format(start_date, "%Y-%m-%d"), sep = "_")
  manifest_parts <- vector("list", length(photo_cols))

  for (i in seq_along(photo_cols)) {
    picture_name <- normalise_text(handw[[photo_cols[[i]]]])
    valid <- !is.na(picture_name) & nzchar(picture_name) & picture_name != "NA"

    if (!any(valid)) {
      manifest_parts[[i]] <- NULL
      next
    }

    original_filename <- trimws(paste(response_id[valid], picture_name[valid], sep = "_"))

    manifest_parts[[i]] <- data.frame(
      source_stem = tolower(tools::file_path_sans_ext(original_filename)),
      expected_filename = original_filename,
      target_base = gsub(":", "-", paste(pid_date[valid], suffixes[[i]], sep = "_"), fixed = TRUE),
      stringsAsFactors = FALSE
    )
  }

  manifest <- do.call(rbind, manifest_parts)
  if (is.null(manifest) || nrow(manifest) == 0) {
    stop(
      sprintf("No image filenames were found in the .sav file for Cohort '%s'.", cohort),
      call. = FALSE
    )
  }

  manifest <- unique(manifest)

  targets_by_source <- split(manifest$target_base, manifest$source_stem)
  conflicting_sources <- names(Filter(function(x) length(unique(x)) > 1, targets_by_source))
  if (length(conflicting_sources) > 0) {
    
    conflict_details <- manifest[
      manifest$source_stem %in% conflicting_sources,
      c("source_stem", "expected_filename", "target_base")
    ]
    
    detail_lines <- apply(
      conflict_details,
      1,
      function(x) paste0(
        x[["source_stem"]],
        "  →  ",
        x[["target_base"]]
      )
    )
    
    stop(
      paste(
        c(
          "The following source images map to multiple output filenames:",
          detail_lines,
          "No files were copied."
        ),
        collapse = "\n"
      ),
      call. = FALSE
    )
  }

  manifest <- manifest[!duplicated(manifest$source_stem), , drop = FALSE]
  rownames(manifest) <- NULL
  manifest
}
