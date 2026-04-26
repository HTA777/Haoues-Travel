/**
 * ABU ILYAS UMRAH — أبو إلياس للعمرة
 * Production Backend v4 — Luxury Umrah Booking System
 * 
 * Architecture: Google Apps Script + Google Sheets
 * Features: Dynamic JSON rooms, multi-image, enhanced offer fields
 * Seat Logic: Deduct only on CONFIRMED, restore on un-confirm/delete
 */

const IDS = {
  BOOKINGS: "1Omz6eK_Y8V-lTv1Cx8QKjhrUhqB4T5rIbRtWXRaqVgU",
  OFFERS:   "10rwDsUj5uZdd9QYvkdf3vIP1fVSNGKZgVMqqlMc95XQ",
  ADS:      null,
  SETTINGS: null
};

// OFFERS Column Indexes (0-based for array access)
const OC = {
  ID: 0, NAME: 1, PRICE: 2, START: 3, END: 4, HOTEL: 5,
  SEATS: 6, BOOKED: 7, ROOMS: 8, PUBLISHED: 9,
  AIRLINE: 10, FLIGHT_TYPE: 11, DOCUMENTS: 12, DISTANCE: 13,
  FOOD: 14, HOTEL_MAP: 15, DESCRIPTION: 16, IMAGES: 17,
  TRAVEL_START: 18, TRAVEL_END: 19
};

const DRIVE_FOLDER_ID = "1uudVGi1HICh6PNoWVmECOYYY8vmCPOrs";
// ADMIN_KEY is read from Script Properties ("ADMIN_KEY"). Set it once via:
//   File > Project properties > Script properties OR `PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', '...')`.
const ADMIN_KEY       = (PropertiesService.getScriptProperties().getProperty("ADMIN_KEY") || "admin2025H").trim();
const NOTIFY_EMAIL    = "ahmed.st1440@gmail.com";

/* ══════════════════════════════════════════
   GET ROUTER
   ══════════════════════════════════════════ */
function isAdminKey(k) {
  // Fail-closed: reject empty keys even if ADMIN_KEY itself ended up empty.
  return !!ADMIN_KEY && String(k || "") === ADMIN_KEY;
}

function doGet(e) {
  const action = e.parameter.action;
  const key = e.parameter.key;
  
  try {
    switch(action) {
      case "packages":
        if (isAdminKey(key)) return respond(getAllRows("OFFERS", "العروض"));
        return respond(getPackages());

      case "ads":
        if (!IDS.ADS) return respond([]);
        if (isAdminKey(key)) return respond(getAllRows("ADS", "الإعلانات"));
        return respond(getAds());

      case "settings": return respond(getSettings());
      
      case "setup":
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        return respond(setupSheets());
      
      case "bookings": 
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        return respond(getAllRows("BOOKINGS", "الحجوزات"));
      
      case "adminInitial":
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        return respond({
          bookings: getAllRows("BOOKINGS", "الحجوزات"),
          packages: getAllRows("OFFERS", "العروض"),
          ads:      IDS.ADS ? getAllRows("ADS", "الإعلانات") : [],
          settings: getSettings()
        });

      default: return respond({ error: "إجراء غير صالح" }, 400);
    }
  } catch (err) {
    return respond({ error: err.message }, 500);
  }
}

/* ══════════════════════════════════════════
   POST ROUTER
   ══════════════════════════════════════════ */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    const key = payload.key;

    switch(action) {
      case "book": return respond(processBooking(payload.data));
      case "checkDuplicate": return respond(checkBookingDuplicate(payload.data));

      case "uploadImage":
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        return respond(uploadToDrive(payload.filename, payload.base64));

      case "savePackage":
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        return respond(upsertRow("OFFERS", "العروض", payload.data));

      case "saveAd":
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        if (!IDS.ADS) return respond({ success: false, error: "الإعلانات غير مفعلة حالياً." });
        return respond(upsertRow("ADS", "الإعلانات", payload.data));

      case "updateStatus":
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        return respond(updateStatus(payload.rowIndex, payload.status));

      case "delete":
        if (!isAdminKey(key)) throw new Error("غير مصرّح لك بالوصول.");
        console.log(`🗑️ Delete: type=${payload.type}, row=${payload.rowIndex}`);
        return respond(deleteRow(payload.type, payload.rowIndex));

      default: return respond({ error: "إجراء POST غير صالح" }, 400);
    }
  } catch (err) {
    return respond({ error: err.message }, 500);
  }
}

/* ══════════════════════════════════════════
   BUSINESS LOGIC
   ══════════════════════════════════════════ */

/**
 * Check for duplicate bookings
 * Rule: Same phone OR same name in the SAME offer = duplicate
 * Same phone in DIFFERENT offers = allowed
 */
function checkBookingDuplicate(data) {
  const sheet = getSafeSheet("BOOKINGS", "الحجوزات");
  // Match the assumption made by the loop below (i = 1 skips a header row).
  // If the sheet was populated without a header, ensure one before reading
  // so the first booking row isn't accidentally skipped during this check.
  ensureBookingsHeader_(sheet);
  const values = sheet.getDataRange().getValues();

  const phone = normalizePhone_(data.phone);
  const fName = String(data.firstName || '').trim().toLowerCase();
  const lName = String(data.lastName || '').trim().toLowerCase();
  const pkgName = String(data.package || '').trim();

  for (let i = 1; i < values.length; i++) {
    const existingPhone = normalizePhone_(values[i][3]);
    const existingPkg   = String(values[i][4]).trim();
    
    // Per-offer phone check
    if (phone && existingPhone === phone && existingPkg === pkgName) {
      return { exists: true, error: "رقم الهاتف مسجل مسبقاً في هذا العرض." };
    }
    
    // Name + Offer duplicate
    if (fName && lName && pkgName) {
      const existingFName = String(values[i][1]).trim().toLowerCase();
      const existingLName = String(values[i][2]).trim().toLowerCase();
      if (existingFName === fName && existingLName === lName && existingPkg === pkgName) {
        return { exists: true, error: "لقد قمت مسبقاً بتقديم طلب حجز في هذا العرض بنفس الاسم واللقب." };
      }
    }
  }
  return { exists: false };
}

/**
 * Process a new booking
 * Validates: duplicates, seat availability
 * Does NOT deduct seats (only on CONFIRMED)
 */
function processBooking(data) {
  const sheet = getSafeSheet("BOOKINGS", "الحجوزات");
  ensureBookingsHeader_(sheet);
  // Force phone column (D) to plain-text format so leading 0 is preserved.
  try { sheet.getRange("D:D").setNumberFormat("@"); } catch (_) {}
  const values = sheet.getDataRange().getValues();

  const phone = normalizePhone_(data.phone);
  const fName = String(data.firstName).trim().toLowerCase();
  const lName = String(data.lastName).trim().toLowerCase();
  
  for (let i = 1; i < values.length; i++) {
    const existingPhone = normalizePhone_(values[i][3]);
    const existingPkg   = String(values[i][4]).trim();
    
    if (existingPhone === phone && existingPkg === data.package) {
      throw new Error("رقم الهاتف مسجل مسبقاً في هذا العرض.");
    }
    
    const existingFName = String(values[i][1]).trim().toLowerCase();
    const existingLName = String(values[i][2]).trim().toLowerCase();
    
    if (existingFName === fName && existingLName === lName && existingPkg === data.package) {
      throw new Error("لقد قمت مسبقاً بتقديم طلب حجز في هذا العرض بنفس الاسم واللقب.");
    }
  }

  // Validate seat availability (without deducting)
  const offerSheet = getSafeSheet("OFFERS", "العروض");
  const offers = offerSheet.getDataRange().getValues();
  let foundIndex = -1;

  for (let i = 1; i < offers.length; i++) {
    if (offers[i][OC.NAME] === data.package) {
      foundIndex = i + 1;
      const total = parseInt(offers[i][OC.SEATS]);
      const booked = parseInt(offers[i][OC.BOOKED] || 0);
      const requested = parseInt(data.pax);

      if (booked + requested > total) throw new Error("عذراً، المقاعد المتبقية غير كافية.");
      break;
    }
  }

  if (foundIndex === -1) throw new Error("الباقة غير موجودة أو انتهى عرضها.");

  // Save booking
  const ts = new Date();
  // Column D is forced to plain-text format (@) above, which already preserves
  // the leading 0. No apostrophe prefix needed (and would be stored literally).
  sheet.appendRow([
    ts,
    data.firstName,
    data.lastName,
    phone,
    data.package,
    data.pax,
    data.roomType,
    "PENDING",
    data.totalPrice || 0
  ]);

  // Send notification with the normalized phone so the email matches the sheet.
  sendBookingEmail(Object.assign({}, data, { phone: phone }), ts);
  return { success: true };
}

/**
 * Upsert a row (create or update)
 * For OFFERS: validates JSON rooms format
 */
function upsertRow(idKey, sheetName, data) {
  if (idKey === "OFFERS") {
    // Validate rooms JSON
    const roomsStr = data.values[OC.ROOMS];
    if (roomsStr && typeof roomsStr === 'string' && roomsStr.trim().startsWith('[')) {
      try {
        const rooms = JSON.parse(roomsStr);
        if (!Array.isArray(rooms)) throw new Error("الغرف يجب أن تكون مصفوفة JSON.");
        rooms.forEach((room, idx) => {
          if (!room.name) throw new Error("الغرفة " + (idx + 1) + ": الاسم مطلوب.");
          if (!room.price || isNaN(room.price)) throw new Error("الغرفة " + (idx + 1) + ": السعر غير صالح.");
        });
      } catch(e) {
        if (e.message.includes("الغرف") || e.message.includes("الغرفة")) throw e;
        throw new Error("صيغة JSON للغرف غير صالحة: " + e.message);
      }
    }
    
    // Validate images JSON
    const imagesStr = data.values[OC.IMAGES];
    if (imagesStr && typeof imagesStr === 'string' && imagesStr.trim().startsWith('[')) {
      try {
        const images = JSON.parse(imagesStr);
        if (!Array.isArray(images)) throw new Error("الصور يجب أن تكون مصفوفة JSON.");
      } catch(e) {
        if (e.message.includes("الصور")) throw e;
        throw new Error("صيغة JSON للصور غير صالحة.");
      }
    }
  }

  const sheet = getSafeSheet(idKey, sheetName);
  const rowIdx = data.rowIndex ? parseInt(data.rowIndex) : null;

  // Normalize values: coerce ISO date strings on TRAVEL_START/END to Date so
  // the cell stores a real date rather than an opaque string.
  if (idKey === "OFFERS") {
    [OC.TRAVEL_START, OC.TRAVEL_END, OC.START, OC.END].forEach(function (ci) {
      var v = data.values[ci];
      if (v && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
        var d = new Date(v);
        if (!isNaN(d.getTime())) data.values[ci] = d;
      }
    });
  }

  // Ensure the sheet has at least as many columns as we're writing — otherwise
  // setValues throws and recent columns (e.g. TRAVEL_START/END) silently fail.
  var needCols = data.values.length;
  var maxCols = sheet.getMaxColumns();
  if (needCols > maxCols) {
    sheet.insertColumnsAfter(maxCols, needCols - maxCols);
  }

  if (rowIdx && rowIdx > 0) {
    const range = sheet.getRange(rowIdx, 1, 1, needCols);
    const existingId = sheet.getRange(rowIdx, 1).getValue();
    data.values[0] = existingId;
    range.setValues([data.values]);
  } else {
    const id = (idKey === "OFFERS" ? "PKG_" : "AD_") + new Date().getTime();
    const newRow = [id, ...data.values.slice(1)];
    // Pad new row to full sheet width so Sheets doesn't truncate the array.
    while (newRow.length < needCols) newRow.push("");
    sheet.appendRow(newRow);
  }
  return { success: true };
}

/**
 * Update booking status
 * Seat deduction: ONLY on CONFIRMED transition
 */
function updateStatus(rowIndex, status) {
  const sheet = getSafeSheet("BOOKINGS", "الحجوزات");
  
  const existingStatus = sheet.getRange(rowIndex, 8).getValue();
  const targetOfferName = sheet.getRange(rowIndex, 5).getValue();
  const pax = parseInt(sheet.getRange(rowIndex, 6).getValue()) || 0;
  
  sheet.getRange(rowIndex, 8).setValue(status);
  
  if (existingStatus !== "CONFIRMED" && status === "CONFIRMED") {
    adjustOfferSeats(targetOfferName, pax);
  } else if (existingStatus === "CONFIRMED" && status !== "CONFIRMED") {
    adjustOfferSeats(targetOfferName, -pax);
  }
  
  return { success: true };
}

/**
 * Adjust offer seat count
 * Uses OC constants for column references
 */
function adjustOfferSeats(offerName, deltaPax) {
  if (deltaPax === 0) return;
  const offerSheet = getSafeSheet("OFFERS", "العروض");
  const offers = offerSheet.getDataRange().getValues();
  
  for (let i = 1; i < offers.length; i++) {
    if (String(offers[i][OC.NAME]).trim() === String(offerName).trim()) {
      const foundIndex = i + 1;
      const total = parseInt(offers[i][OC.SEATS]) || 0;
      let booked = parseInt(offers[i][OC.BOOKED]) || 0;
      
      booked += deltaPax;
      if (booked < 0) booked = 0;
      
      offerSheet.getRange(foundIndex, OC.BOOKED + 1).setValue(booked);
      
      if (total > 0 && booked >= total) {
        offerSheet.getRange(foundIndex, OC.PUBLISHED + 1).setValue(false);
      } else if (booked < total) {
        offerSheet.getRange(foundIndex, OC.PUBLISHED + 1).setValue(true);
      }
      break;
    }
  }
}

/**
 * Delete a row with seat restoration for confirmed bookings
 */
function deleteRow(type, rowIndex) {
  const idx = parseInt(rowIndex);
  if (isNaN(idx) || idx < 1) throw new Error("رقم الصف غير صالح: " + rowIndex);

  const sheetNames = {
    "BOOKINGS": "الحجوزات",
    "OFFERS": "العروض",
    "ADS": "الإعلانات"
  };

  const sheetName = sheetNames[type];
  if (!sheetName) throw new Error("نوع البيانات غير صالح: " + type);
  if (!IDS[type]) throw new Error("هذا النوع غير مفعّل حالياً.");

  const sheet = getSafeSheet(type, sheetName);
  const lastRow = sheet.getLastRow();
  
  if (idx > lastRow) throw new Error("الصف " + idx + " غير موجود. آخر صف هو " + lastRow + ".");

  // Restore seats for confirmed booking deletions
  if (type === "BOOKINGS") {
    const status = String(sheet.getRange(idx, 8).getValue()).toUpperCase();
    const offerName = sheet.getRange(idx, 5).getValue();
    const pax = parseInt(sheet.getRange(idx, 6).getValue()) || 0;
    
    if (status === "CONFIRMED" || status === "تم التأكيد") {
      console.log("♻️ Restoring " + pax + " seats for [" + offerName + "]");
      adjustOfferSeats(offerName, -pax);
    }
  }

  sheet.deleteRow(idx);
  return { success: true };
}

/* ══════════════════════════════════════════
   DATA ACCESS
   ══════════════════════════════════════════ */

function getSafeSheet(idKey, name) {
  if (!IDS[idKey]) throw new Error("الورقة [" + idKey + "] غير مهيأة.");
  const ss = SpreadsheetApp.openById(IDS[idKey]);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    const sheets = ss.getSheets();
    sheet = sheets.find(s => s.getName().toLowerCase().includes(name.toLowerCase()));
    if (!sheet) {
      console.log("⚠️ Sheet [" + name + "] not found. Using first sheet.");
      sheet = sheets[0];
    }
  }
  return sheet;
}

/**
 * Get published packages for public website
 * Returns enhanced data with all new fields
 */
function getPackages() {
  const sheet = getSafeSheet("OFFERS", "العروض");
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  return values.slice(1).filter(r => {
    const isPublished = r[OC.PUBLISHED] === true || r[OC.PUBLISHED] === "TRUE" || String(r[OC.PUBLISHED]).toLowerCase() === "true";
    if (!isPublished) return false;

    const startStr = String(r[OC.START] || '').trim();
    const endStr   = String(r[OC.END] || '').trim();
    const startDate = startStr ? new Date(startStr) : null;
    const endDate   = endStr ? new Date(endStr) : null;

    if (startDate && !isNaN(startDate.getTime()) && startDate > now) return false;
    if (endDate && !isNaN(endDate.getTime()) && endDate < now) return false;

    const total = parseInt(r[OC.SEATS]) || 0;
    const booked = parseInt(r[OC.BOOKED]) || 0;
    if (total > 0 && booked >= total) return false;

    return true;
  }).map(r => ({
    id: r[OC.ID], name: r[OC.NAME], price: r[OC.PRICE],
    start: r[OC.START], end: r[OC.END], hotel: r[OC.HOTEL],
    seats: r[OC.SEATS], booked: r[OC.BOOKED],
    rooms: r[OC.ROOMS], published: r[OC.PUBLISHED],
    airline: r[OC.AIRLINE] || '', flightType: r[OC.FLIGHT_TYPE] || '',
    documents: r[OC.DOCUMENTS] || '', distanceHaram: r[OC.DISTANCE] || '',
    food: r[OC.FOOD] || '', hotelMap: r[OC.HOTEL_MAP] || '',
    description: r[OC.DESCRIPTION] || '', images: r[OC.IMAGES] || '[]',
    travelStart: r[OC.TRAVEL_START] || '', travelEnd: r[OC.TRAVEL_END] || ''
  }));
}

/**
 * Get active ads (date-filtered)
 */
function getAds() {
  if (!IDS.ADS) return [];
  const sheet = getSafeSheet("ADS", "الإعلانات");
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  
  const results = [];
  
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    const activeVal = r[8];
    const isActive = (activeVal === true) || (activeVal === "TRUE") || (activeVal === "true") ||
                     (activeVal === 1) || (activeVal === "1") || (activeVal === "نعم") ||
                     (typeof activeVal === 'string' && activeVal.toLowerCase().trim() === "true");
    
    if (!isActive) continue;
    
    if (r[6] || r[7]) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const startStr = String(r[6] || '').trim();
      const endStr   = String(r[7] || '').trim();
      const startDate = startStr ? new Date(startStr) : null;
      const endDate   = endStr ? new Date(endStr) : null;
      
      if (startDate && !isNaN(startDate.getTime())) {
        startDate.setHours(0, 0, 0, 0);
        if (now < startDate) continue;
      }
      if (endDate && !isNaN(endDate.getTime())) {
        endDate.setHours(0, 0, 0, 0);
        if (now > endDate) continue;
      }
    }
    
    results.push({
      id: r[0], type: String(r[1] || '').trim(), title: String(r[2] || '').trim(),
      text: String(r[3] || '').trim(), image: String(r[4] || '').trim(),
      position: String(r[5] || '').trim(), start: r[6], end: r[7]
    });
  }
  return results;
}

/**
 * Get settings (hardcoded for Abu Ilyas, or from sheet)
 */
function getSettings() {
  if (!IDS.SETTINGS) {
    return {
      agency_name: "أبو إلياس للعمرة",
      page_title: "أبو إلياس للعمرة | استقبال وتوجيه وخدمات المطار",
      phone: "0771266273",
      phone2: "0553949407",
      phone3: "0663723805",
      email: "ahmed.st1440@gmail.com",
      address: "بوعرفة — البليدة، الجزائر",
      facebook: "https://www.facebook.com/abw.alyas.ll.mrt",
      whatsapp: "213771266273"
    };
  }
  const sheet = getSafeSheet("SETTINGS", "الاعدادات");
  if (!sheet) return {};
  const values = sheet.getDataRange().getValues();
  const obj = {};
  values.forEach(r => { if(r[0]) obj[r[0]] = r[1]; });
  return obj;
}

/**
 * Get ALL rows from a sheet (admin panel)
 * Returns array of objects with Arabic + English keys
 */
function getAllRows(idKey, sheetName) {
  try {
    const sheet = getSafeSheet(idKey, sheetName);
    // Ensure BOOKINGS sheet has a header BEFORE computing rowIndex, otherwise a
    // concurrent processBooking could insert one between the read and a later
    // admin write (delete/updateStatus), shifting rows and invalidating indices.
    if (idKey === "BOOKINGS") ensureBookingsHeader_(sheet);
    const values = sheet.getDataRange().getValues();
    if (values.length === 0) return [];
    // Detect header row: a string label in column 0 (e.g. "timestamp", "id").
    // If column 0 of row 0 is a Date or numeric ID, treat ALL rows as data.
    const first0 = values[0][0];
    const hasHeader = (typeof first0 === "string") && first0.length > 0 && !/^\d/.test(first0);
    const dataRows = hasHeader ? values.slice(1) : values;
    const baseIndex = hasHeader ? 2 : 1;
    if (dataRows.length === 0) return [];
    // Empty Sheets returns [[""]] from getDataRange — guard against the
    // single-empty-row ghost from showing up as a phantom record.
    if (dataRows.length === 1 && dataRows[0].every(c => c === "" || c === null)) return [];
    return dataRows.map((r, i) => {
      let row = { rowIndex: i + baseIndex };
      if (idKey === "BOOKINGS") {
        row["timestamp"] = r[0]; row["الاسم"] = r[1]; row["اللقب"] = r[2];
        row["الهاتف"] = normalizePhone_(r[3]); row["الباقة"] = r[4]; row["الأشخاص"] = r[5];
        row["الغرفة"] = r[6]; row["الحالة"] = r[7]; row["السعر"] = r[8] || 0;
      } else if (idKey === "OFFERS") {
        row["id"] = r[OC.ID]; row["الاسم"] = r[OC.NAME]; row["السعر"] = r[OC.PRICE];
        row["البداية"] = r[OC.START]; row["النهاية"] = r[OC.END]; row["الفندق"] = r[OC.HOTEL];
        row["المقاعد"] = r[OC.SEATS]; row["المحجوزة"] = r[OC.BOOKED];
        row["الغرف"] = r[OC.ROOMS]; row["منشور"] = r[OC.PUBLISHED];
        row["شركة_الطيران"] = r[OC.AIRLINE] || '';
        row["نوع_الرحلة"] = r[OC.FLIGHT_TYPE] || '';
        row["الوثائق_المطلوبة"] = r[OC.DOCUMENTS] || '';
        row["المسافة_عن_الحرم"] = r[OC.DISTANCE] || '';
        row["الإطعام"] = r[OC.FOOD] || '';
        row["رابط_الفندق"] = r[OC.HOTEL_MAP] || '';
        row["الوصف"] = r[OC.DESCRIPTION] || '';
        row["الصور"] = r[OC.IMAGES] || '';
        row["تاريخ_الذهاب"] = r[OC.TRAVEL_START] || '';
        row["تاريخ_العودة"] = r[OC.TRAVEL_END] || '';
      } else if (idKey === "ADS") {
        row["id"] = r[0]; row["النوع"] = r[1]; row["العنوان"] = r[2]; 
        row["النص"] = r[3]; row["صورة_url"] = r[4]; row["المكان"] = r[5]; 
        row["البداية"] = r[6]; row["النهاية"] = r[7]; row["مفعّل"] = r[8];
      }
      return row;
    });
  } catch (e) {
    console.log("Error in getAllRows: " + e.message);
    return [];
  }
}

/* ══════════════════════════════════════════
   IMAGE UPLOAD TO GOOGLE DRIVE
   ══════════════════════════════════════════ */

function uploadToDrive(filename, base64) {
  try {
    if (!base64 || base64.length < 100) {
      throw new Error("بيانات الصورة فارغة أو غير صالحة.");
    }
    
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    if (!folder) throw new Error("مجلد الصور غير موجود.");
    
    let contentType = "image/jpeg";
    let rawData = base64;
    
    if (base64.indexOf(',') !== -1) {
      const header = base64.substring(0, base64.indexOf(','));
      rawData = base64.split(',')[1];
      const typeMatch = header.match(/data:([^;]+)/);
      if (typeMatch) contentType = typeMatch[1];
    }
    
    const bytes = Utilities.base64Decode(rawData);
    const blob = Utilities.newBlob(bytes, contentType, filename);
    const file = folder.createFile(blob);
    const fileId = file.getId();
    const url = "https://drive.google.com/thumbnail?id=" + fileId + "&sz=w1200";
    
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      console.log("Sharing failed: " + shareErr.message);
    }
    
    return { success: true, url: url, fileId: fileId };
  } catch (err) {
    return { success: false, error: "فشل رفع الصورة: " + err.message };
  }
}

/* ══════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════ */

function respond(data, code) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Luxury Abu Ilyas-branded booking notification email
 */
function sendBookingEmail(data, ts) {
  const timeStr = Utilities.formatDate(ts, "GMT+1", "HH:mm");
  const dateStr = Utilities.formatDate(ts, "GMT+1", "yyyy/MM/dd");

  const row = function(label, value) {
    return '<tr>' +
      '<td style="padding:14px 20px; color:rgba(255,255,255,0.5); font-size:14px; border-bottom:1px solid rgba(255,255,255,0.05); text-align:right;">' + label + '</td>' +
      '<td style="padding:14px 20px; color:#f0f2f8; font-weight:700; font-size:15px; border-bottom:1px solid rgba(255,255,255,0.05); text-align:left;">' + (value || '—') + '</td>' +
    '</tr>';
  };

  const body = '<!DOCTYPE html>' +
'<html lang="ar" dir="rtl">' +
'<head><style>@import url("https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap");</style></head>' +
'<body style="margin:0; padding:0; background-color:#040810; font-family:Tajawal,Segoe UI,sans-serif; direction:rtl; color:#f0f2f8;">' +
'<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#040810; padding:30px 10px;">' +
'<tr><td align="center">' +
'<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; background-color:#060c18; border-radius:28px; overflow:hidden; border:1px solid rgba(48,154,175,0.3); box-shadow:0 25px 50px rgba(0,0,0,0.5);">' +

'<tr><td style="background:linear-gradient(135deg, #d4af37 0%, #1a120a 50%, #040810 100%); padding:60px 30px; text-align:center;">' +
'<div style="font-size:70px; margin-bottom:15px;">🕋</div>' +
'<h1 style="margin:0; color:#FFFFFF; font-size:28px; font-weight:900; letter-spacing:1px; text-shadow:0 2px 10px rgba(48,154,175,0.5);">طلب حجز عمرة جديد</h1>' +
'<p style="margin:12px 0 0; color:rgba(255,255,255,0.7); font-size:16px;">أبو إلياس للعمرة</p>' +
'</td></tr>' +

'<tr><td style="padding:40px 30px;">' +
'<div style="margin-bottom:25px; border-right:4px solid #d4af37; padding-right:15px; text-align:right;">' +
'<h2 style="color:#ae9073; font-size:20px; font-weight:bold; margin:0;">تفاصيل الزبون</h2>' +
'</div>' +
'<table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.02); border-radius:18px; border:1px solid rgba(255,255,255,0.05);">' +
'<tbody>' +
row('👤 الاسم الكامل', data.firstName + ' ' + data.lastName) +
row('📞 رقم الهاتف', '<a href="tel:' + data.phone + '" style="color:#00e6c3; text-decoration:none;">' + data.phone + '</a>') +
row('🕌 الباقة المختارة', '<span style="color:#ae9073;">' + data.package + '</span>') +
row('👥 الأفراد', data.pax + ' أشخاص') +
row('🛏️ الغرفة', data.roomType) +
row('🕐 الساعة', timeStr) +
row('📅 التاريخ', dateStr) +
'</tbody></table>' +
'</td></tr>' +

'<tr><td style="padding:0 30px 50px; text-align:center;">' +
'<div style="background:rgba(48,154,175,0.1); border:1px dashed rgba(48,154,175,0.4); padding:25px; border-radius:20px;">' +
'<p style="color:#f0f2f8; font-weight:bold; font-size:18px; margin:0;">📩 يرجى المتابعة مع الزبون لتأكيد الحجز</p>' +
'</div>' +
'</td></tr>' +

'<tr><td style="background:#02050a; padding:30px; text-align:center; border-top:1px solid rgba(255,255,255,0.05);">' +
'<p style="margin:0; color:rgba(240,242,248,0.2); font-size:11px; letter-spacing:2px;">' +
'© 2026 ABU ILYAS UMRAH | بوعرفة، البليدة، الجزائر' +
'</p></td></tr>' +

'</table></td></tr></table>' +
'</body></html>';
  
  const subject = 'حجز جديد 🕋 [' + data.firstName + ' ' + data.lastName + ']';
  MailApp.sendEmail({ 
    to: NOTIFY_EMAIL, 
    subject: subject, 
    htmlBody: body, 
    name: 'أبو إلياس للعمرة' 
  });
}

/* ══════════════════════════════════════════
   SHEET SETUP
   ══════════════════════════════════════════ */

/**
 * Add header row to BOOKINGS sheet if missing — runs at every booking write.
 * Without a header, getAllRows would mistake the first booking for a header.
 */
function ensureBookingsHeader_(sheet) {
  try {
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["timestamp", "الاسم", "اللقب", "الهاتف", "الباقة", "الأشخاص", "الغرفة", "الحالة", "السعر"]);
      sheet.getRange(1, 1, 1, 9)
        .setBackground("#040810")
        .setFontColor("#ae9073")
        .setFontWeight("bold");
      sheet.setFrozenRows(1);
      return;
    }
    // If the sheet has data but row 1 isn't the expected header, prepend one.
    const first0 = sheet.getRange(1, 1).getValue();
    const looksLikeHeader = (typeof first0 === "string") && first0.toLowerCase() === "timestamp";
    if (!looksLikeHeader) {
      sheet.insertRowBefore(1);
      sheet.getRange(1, 1, 1, 9).setValues([["timestamp", "الاسم", "اللقب", "الهاتف", "الباقة", "الأشخاص", "الغرفة", "الحالة", "السعر"]]);
      sheet.getRange(1, 1, 1, 9)
        .setBackground("#040810")
        .setFontColor("#ae9073")
        .setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  } catch (e) {
    console.log("ensureBookingsHeader_ failed: " + e.message);
  }
}

/**
 * Normalize an Algerian phone number for display.
 * Sheets sometimes strips the leading 0 from "0771266273". Restore it when the
 * value is a 9-digit string starting with 5/6/7 (mobile), or is a Number.
 */
function normalizePhone_(raw) {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  // strip leading apostrophe (used to force text in Sheets)
  if (s.charAt(0) === "'") s = s.substring(1);
  // strip non-digits other than +
  const digits = s.replace(/[^0-9]/g, "");
  if (digits.length === 9 && /^[5-7]/.test(digits)) return "0" + digits;
  if (digits.length === 10) return digits;
  return s;
}

function setupSheets() {
  const setup = [
    { 
      id: IDS.BOOKINGS, 
      name: "الحجوزات", 
      headers: ["timestamp", "الاسم", "اللقب", "الهاتف", "الباقة", "الأشخاص", "الغرفة", "الحالة", "السعر"] 
    },
    { 
      id: IDS.OFFERS, 
      name: "العروض", 
      headers: [
        "id", "الاسم", "السعر", "البداية", "النهاية", "الفندق",
        "المقاعد", "المحجوزة", "الغرف", "منشور",
        "شركة_الطيران", "نوع_الرحلة", "الوثائق_المطلوبة", "المسافة_عن_الحرم",
        "الإطعام", "رابط_الفندق", "الوصف", "الصور", "تاريخ_الذهاب", "تاريخ_العودة"
      ]
    }
  ];

  const results = [];

  setup.forEach(function(conf) {
    if (!conf.id) {
      results.push("⏭️ Skipped [" + conf.name + "] — no sheet ID configured.");
      return;
    }
    try {
      const ss = SpreadsheetApp.openById(conf.id);
      let sheet = ss.getSheetByName(conf.name);
      
      if (!sheet) {
        sheet = ss.insertSheet(conf.name);
        var s1 = ss.getSheetByName("Sheet1");
        if (s1 && s1.getLastRow() === 0) {
          try { ss.deleteSheet(s1); } catch(e) {}
        }
      }
      
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(conf.headers);
        sheet.getRange(1, 1, 1, conf.headers.length)
          .setBackground("#040810")
          .setFontColor("#ae9073")
          .setFontWeight("bold");
        sheet.setFrozenRows(1);
      }
      
      results.push("✅ Sheet [" + conf.name + "] initialized.");
    } catch (err) {
      results.push("❌ Error [" + conf.name + "]: " + err.message);
    }
  });

  return { success: true, log: results };
}
