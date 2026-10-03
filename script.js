const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const SUPABASE_URL = "https://mlqifesgqkwmbxylizic.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_4qq_ptvC7mejLSg07BzSog_yHrXICe3";
const STORAGE_BUCKET = "receipt-assets";

const fieldIds = [
  "organizer-name",
  "event-name",
  "organizer-address",
  "receipt-number",
  "payment-date",
  "payment-method",
  "payment-status",
  "payer-name",
  "signer-title",
  "signer-name",
];

const headerFieldIds = ["organizer-name", "event-name", "organizer-address", "signer-title", "signer-name"];
const itemsEditor = document.querySelector("#items-editor");
const previewItems = document.querySelector("#preview-items");
const logoInput = document.querySelector("#organization-logo");
const signatureInput = document.querySelector("#signature-image");
const headerSettings = document.querySelector("#header-settings");
const headerSaveStatus = document.querySelector("#header-save-status");
let headerLogoDataUrl = null;
let headerSignatureDataUrl = null;
let savedIdentitySettings = null;
let isEditingIdentity = false;
let currentSession = null;
let supabaseClient = null;
let pendingLogoFile = null;
let pendingSignatureFile = null;
let logoPreviewObjectUrl = null;
let signaturePreviewObjectUrl = null;

function addItem(player = "", number = "", match = "", card = "KK", amount = 25000) {
  const row = document.createElement("div");
  row.className = "item-editor-row";

  const playerField = createField("Nama pemain", "text", player, "item-player");
  playerField.input.placeholder = "Nama pemain";
  playerField.wrapper.classList.add("item-field-description");

  const numberField = createField("No. punggung", "text", number, "item-number");
  numberField.input.placeholder = "No.";

  const matchField = createField("Pertandingan", "text", match, "item-match");
  matchField.input.placeholder = "Contoh: 1 Okt 2026";
  matchField.wrapper.classList.add("item-field-match");

  const cardField = createField("Kartu", "text", card, "item-card");
  cardField.input.placeholder = "KK / KM";

  const amountField = createField("Denda (Rp)", "number", amount, "item-amount");
  amountField.input.min = "0";
  amountField.input.step = "1000";
  amountField.input.inputMode = "numeric";
  amountField.wrapper.classList.add("item-field-price");

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "remove-item";
  removeButton.setAttribute("aria-label", "Hapus pemain");
  removeButton.textContent = "Hapus pemain";
  removeButton.addEventListener("click", () => {
    row.remove();
    updatePreview();
  });

  row.append(
    playerField.wrapper,
    numberField.wrapper,
    matchField.wrapper,
    cardField.wrapper,
    amountField.wrapper,
    removeButton,
  );
  itemsEditor.append(row);
  row.addEventListener("input", updatePreview);
  updatePreview();
}

function createField(labelText, type, value, inputClass) {
  const wrapper = document.createElement("div");
  wrapper.className = "item-field";

  const label = document.createElement("label");
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = type;
  input.value = String(value);
  input.setAttribute("aria-label", labelText);
  input.className = inputClass;

  wrapper.append(label, input);
  return { wrapper, input };
}

function formatRupiah(value) {
  return rupiahFormatter.format(Math.round(value));
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
}

function setText(selector, value, fallback = "—") {
  const element = document.querySelector(selector);
  element.textContent = value.trim() || fallback;
}

function setHeaderSaveStatus(message, isError = false) {
  headerSaveStatus.textContent = message;
  headerSaveStatus.classList.toggle("error", isError);
}

function setIdentitySettings(settings) {
  const fieldMap = {
    "organizer-name": "organizer_name",
    "event-name": "event_name",
    "organizer-address": "organizer_address",
    "signer-title": "signer_title",
    "signer-name": "signer_name",
  };
  for (const [id, key] of Object.entries(fieldMap)) {
    if (typeof settings[key] === "string") document.querySelector(`#${id}`).value = settings[key];
  }

  headerLogoDataUrl = typeof settings.logo_url === "string" ? settings.logo_url : null;
  headerSignatureDataUrl = typeof settings.signature_url === "string" ? settings.signature_url : null;

  const logoImage = document.querySelector("#preview-logo");
  const logoWrap = document.querySelector("#logo-wrap");
  if (headerLogoDataUrl) logoImage.src = headerLogoDataUrl;
  else logoImage.removeAttribute("src");
  logoWrap.hidden = !headerLogoDataUrl;

  const signatureImage = document.querySelector("#preview-signature");
  const signatureWrap = document.querySelector("#signature-wrap");
  if (headerSignatureDataUrl) signatureImage.src = headerSignatureDataUrl;
  else signatureImage.removeAttribute("src");
  signatureWrap.hidden = !headerSignatureDataUrl;
  updatePreview();
}

function setIdentityEditing(isEditing) {
  isEditingIdentity = isEditing && Boolean(currentSession);
  for (const id of [...headerFieldIds, "organization-logo", "signature-image"]) {
    document.querySelector(`#${id}`).disabled = !isEditingIdentity;
  }
  document.querySelector("#identity-edit-button").disabled = !currentSession;
  document.querySelector("#identity-edit-button").hidden = isEditingIdentity;
  document.querySelector("#identity-edit-actions").hidden = !isEditingIdentity;
}

function setConnectionStatus(message, isError = false) {
  const status = document.querySelector("#connection-status");
  status.lastChild.textContent = ` ${message}`;
  status.classList.toggle("connection-error", isError);
}

function updateAdminUi() {
  const signedIn = Boolean(currentSession);
  document.querySelector("#admin-email").closest(".field").hidden = signedIn;
  document.querySelector("#admin-password").closest(".field").hidden = signedIn;
  document.querySelector("#admin-login-button").hidden = signedIn;
  document.querySelector("#admin-logout-button").hidden = !signedIn;
  document.querySelector("#admin-session-status").textContent = signedIn
    ? `Masuk sebagai ${currentSession.user.email || "admin"}`
    : "Belum masuk";
  if (!signedIn && isEditingIdentity) {
    setIdentityEditing(false);
    if (savedIdentitySettings) setIdentitySettings({
      organizer_name: savedIdentitySettings["organizer-name"],
      event_name: savedIdentitySettings["event-name"],
      organizer_address: savedIdentitySettings["organizer-address"],
      signer_title: savedIdentitySettings["signer-title"],
      signer_name: savedIdentitySettings["signer-name"],
      logo_url: savedIdentitySettings.logoUrl,
      signature_url: savedIdentitySettings.signatureUrl,
    });
  } else {
    setIdentityEditing(isEditingIdentity);
  }
}

async function uploadIdentityAsset(file, kind) {
  const extensionByType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  const extension = extensionByType[file.type];
  if (!extension) throw new Error("Gunakan gambar PNG, JPG, SVG, atau WebP.");
  if (file.size > 1024 * 1024) throw new Error("Ukuran setiap gambar maksimal 1 MB.");

  const uniquePart = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const path = `identity/${kind}-${uniquePart}.${extension}`;
  const { error: uploadError } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (uploadError) throw uploadError;

  const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function persistHeaderSettings() {
  if (!currentSession) {
    setHeaderSaveStatus("Masuk dengan akun admin sebelum menyimpan identitas.", true);
    return;
  }

  const saveButton = document.querySelector("#identity-save-button");
  saveButton.disabled = true;
  setHeaderSaveStatus("Menyimpan identitas dan gambar ke Supabase…");
  let uploadedLogoUrl = null;
  let uploadedSignatureUrl = null;

  try {
    let logoUrl = headerLogoDataUrl;
    let signatureUrl = headerSignatureDataUrl;
    if (pendingLogoFile) {
      uploadedLogoUrl = await uploadIdentityAsset(pendingLogoFile, "logo");
      logoUrl = uploadedLogoUrl;
    }
    if (pendingSignatureFile) {
      uploadedSignatureUrl = await uploadIdentityAsset(pendingSignatureFile, "signature");
      signatureUrl = uploadedSignatureUrl;
    }

    const values = Object.fromEntries(
      headerFieldIds.map(id => [id, document.querySelector(`#${id}`).value.trim()]),
    );
    const { data, error } = await supabaseClient
      .from("receipt_identity")
      .update({
        organizer_name: values["organizer-name"],
        event_name: values["event-name"],
        organizer_address: values["organizer-address"],
        signer_title: values["signer-title"],
        signer_name: values["signer-name"],
        logo_url: logoUrl,
        signature_url: signatureUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1)
      .select("organizer_name,event_name,organizer_address,signer_title,signer_name,logo_url,signature_url")
      .single();

    if (error) throw error;

    pendingLogoFile = null;
    pendingSignatureFile = null;
    if (logoPreviewObjectUrl) URL.revokeObjectURL(logoPreviewObjectUrl);
    if (signaturePreviewObjectUrl) URL.revokeObjectURL(signaturePreviewObjectUrl);
    logoPreviewObjectUrl = null;
    signaturePreviewObjectUrl = null;
    logoInput.value = "";
    signatureInput.value = "";
    savedIdentitySettings = {
      "organizer-name": data.organizer_name,
      "event-name": data.event_name,
      "organizer-address": data.organizer_address,
      "signer-title": data.signer_title,
      "signer-name": data.signer_name,
      logoUrl: data.logo_url,
      signatureUrl: data.signature_url,
    };
    setIdentitySettings(data);
    setIdentityEditing(false);
    setHeaderSaveStatus("Identitas dan pengesahan berhasil disimpan online.");
    setConnectionStatus("Terhubung ke Supabase");
  } catch (error) {
    setHeaderSaveStatus(`Gagal menyimpan: ${error.message || "periksa koneksi, sesi admin, dan kebijakan Supabase."}`, true);
    console.error("Gagal menyimpan identitas ke Supabase.", error);
    if (uploadedLogoUrl || uploadedSignatureUrl) {
      const uploadedPaths = [uploadedLogoUrl, uploadedSignatureUrl]
        .filter(Boolean)
        .map(url => url.split(`/object/public/${STORAGE_BUCKET}/`)[1])
        .filter(Boolean);
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabaseClient.storage.from(STORAGE_BUCKET).remove(uploadedPaths);
        if (cleanupError) console.error("Gagal membersihkan gambar yang tidak tersimpan.", cleanupError);
      }
    }
  } finally {
    saveButton.disabled = false;
  }
}

async function loadIdentitySettings() {
  const { data, error } = await supabaseClient
    .from("receipt_identity")
    .select("organizer_name,event_name,organizer_address,signer_title,signer_name,logo_url,signature_url")
    .eq("id", 1)
    .single();

  if (error) throw error;
  setIdentitySettings(data);
  savedIdentitySettings = {
    "organizer-name": data.organizer_name,
    "event-name": data.event_name,
    "organizer-address": data.organizer_address,
    "signer-title": data.signer_title,
    "signer-name": data.signer_name,
    logoUrl: data.logo_url,
    signatureUrl: data.signature_url,
  };
  setHeaderSaveStatus(currentSession
    ? "Identitas dimuat dari penyimpanan bersama. Anda masuk sebagai admin."
    : "Identitas dimuat dari penyimpanan bersama. Masuk sebagai admin untuk mengubah.");
}

async function initializeSupabase() {
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    setConnectionStatus("Library Supabase gagal dimuat; periksa koneksi internet.", true);
    setHeaderSaveStatus("Tidak dapat menghubungkan ke Supabase karena library tidak termuat.", true);
    document.querySelector("#admin-login-button").disabled = true;
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    updateAdminUi();
  });

  try {
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    currentSession = sessionData?.session || null;
    updateAdminUi();
    await loadIdentitySettings();
    setConnectionStatus("Terhubung ke Supabase");
  } catch (error) {
    setConnectionStatus("Gagal memuat identitas online", true);
    setHeaderSaveStatus(`Identitas online gagal dimuat: ${error.message || "periksa tabel dan kebijakan Supabase."}`, true);
    console.error("Gagal memuat identitas dari Supabase.", error);
  }
}

function terbilang(value) {
  const number = Math.floor(Math.max(0, value));
  if (number === 0) return "Nol rupiah";
  if (number > 999_999_999_999) return "Jumlah terlalu besar untuk ditulis dengan kata-kata.";
  return `${spellNumber(number).trim()} rupiah`;
}

function spellNumber(number) {
  if (number === 0) return "";

  const words = [
    "nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan",
    "sepuluh", "sebelas",
  ];

  if (number < 12) return `${words[number]} `;
  if (number < 20) return `${spellNumber(number - 10)}belas `;
  if (number < 100) return `${spellNumber(Math.floor(number / 10))}puluh ${spellNumber(number % 10)}`;
  if (number < 200) return `seratus ${spellNumber(number - 100)}`;
  if (number < 1000) return `${spellNumber(Math.floor(number / 100))}ratus ${spellNumber(number % 100)}`;
  if (number < 2000) return `seribu ${spellNumber(number - 1000)}`;
  if (number < 1_000_000) return `${spellNumber(Math.floor(number / 1000))}ribu ${spellNumber(number % 1000)}`;
  if (number < 1_000_000_000) return `${spellNumber(Math.floor(number / 1_000_000))}juta ${spellNumber(number % 1_000_000)}`;
  if (number < 1_000_000_000_000) {
    return `${spellNumber(Math.floor(number / 1_000_000_000))}miliar ${spellNumber(number % 1_000_000_000)}`;
  }
  return "";
}

function updatePreview() {
  for (const [source, target, fallback] of [
    ["#organizer-name", "#preview-organizer-name", "PANITIA PENYELENGGARA"],
    ["#event-name", "#preview-event-name", "NAMA TURNAMEN"],
    ["#organizer-address", "#preview-organizer-address", ""],
    ["#receipt-number", "#preview-receipt-number", "—"],
    ["#payment-method", "#preview-payment-method", "—"],
    ["#payment-status", "#preview-payment-status", "—"],
    ["#payer-name", "#preview-payer-name", "Nama pembayar"],
    ["#signer-title", "#preview-signer-title", "Ketua Panitia"],
    ["#signer-name", "#preview-signer-name", "Nama penandatangan"],
  ]) {
    setText(target, document.querySelector(source).value, fallback);
  }

  setText("#preview-payment-date", formatDate(document.querySelector("#payment-date").value));

  const rows = [...itemsEditor.querySelectorAll(".item-editor-row")];
  previewItems.replaceChildren();
  let total = 0;

  rows.forEach((row, index) => {
    const player = row.querySelector(".item-player").value.trim() || "—";
    const number = row.querySelector(".item-number").value.trim() || "—";
    const match = row.querySelector(".item-match").value.trim() || "—";
    const card = row.querySelector(".item-card").value.trim() || "—";
    const amount = Math.max(0, Number(row.querySelector(".item-amount").value) || 0);
    total += amount;

    const previewRow = document.createElement("tr");
    for (const text of [String(index + 1), player, number, match, card, formatRupiah(amount)]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      previewRow.append(cell);
    }
    previewItems.append(previewRow);
  });

  document.querySelector("#preview-total").textContent = formatRupiah(total);
  document.querySelector("#preview-total-words").textContent = terbilang(total);
}

function setTodayDate() {
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000);
  document.querySelector("#payment-date").value = localDate.toISOString().slice(0, 10);
}

function saveIdentityImage(input, image, wrapper, type) {
  const file = input.files && input.files[0];
  if (!file) return;

  if (file.size > 1024 * 1024) {
    setHeaderSaveStatus("Ukuran gambar maksimal 1 MB agar dapat disimpan di Storage.", true);
    input.value = "";
    return;
  }

  if (!file.type.startsWith("image/")) {
    setHeaderSaveStatus("Pilih berkas gambar yang valid.", true);
    input.value = "";
    return;
  }

  if (type === "logo") {
    pendingLogoFile = file;
    if (logoPreviewObjectUrl) URL.revokeObjectURL(logoPreviewObjectUrl);
    logoPreviewObjectUrl = URL.createObjectURL(file);
    image.src = logoPreviewObjectUrl;
  } else {
    pendingSignatureFile = file;
    if (signaturePreviewObjectUrl) URL.revokeObjectURL(signaturePreviewObjectUrl);
    signaturePreviewObjectUrl = URL.createObjectURL(file);
    image.src = signaturePreviewObjectUrl;
  }
  wrapper.hidden = false;
  setHeaderSaveStatus("Gambar dipilih. Tekan “Simpan identitas” untuk mengunggahnya.");
}

for (const id of fieldIds) {
  document.querySelector(`#${id}`).addEventListener("input", () => {
    updatePreview();
    if (headerFieldIds.includes(id) && isEditingIdentity) {
      setHeaderSaveStatus("Perubahan belum disimpan. Tekan “Simpan identitas” untuk menyimpan.");
    }
  });
}

document.querySelector("#add-item-button").addEventListener("click", () => addItem());
document.querySelector("#print-button").addEventListener("click", () => window.print());
document.querySelector("#identity-edit-button").addEventListener("click", () => {
  setIdentityEditing(true);
  setHeaderSaveStatus("Edit identitas, lalu tekan “Simpan identitas”. Tekan “Batal” untuk membuang perubahan.");
});
document.querySelector("#identity-save-button").addEventListener("click", persistHeaderSettings);
document.querySelector("#identity-cancel-button").addEventListener("click", () => {
  if (logoPreviewObjectUrl) URL.revokeObjectURL(logoPreviewObjectUrl);
  if (signaturePreviewObjectUrl) URL.revokeObjectURL(signaturePreviewObjectUrl);
  logoPreviewObjectUrl = null;
  signaturePreviewObjectUrl = null;
  pendingLogoFile = null;
  pendingSignatureFile = null;
  logoInput.value = "";
  signatureInput.value = "";
  if (savedIdentitySettings) {
    setIdentitySettings({
      organizer_name: savedIdentitySettings["organizer-name"],
      event_name: savedIdentitySettings["event-name"],
      organizer_address: savedIdentitySettings["organizer-address"],
      signer_title: savedIdentitySettings["signer-title"],
      signer_name: savedIdentitySettings["signer-name"],
      logo_url: savedIdentitySettings.logoUrl,
      signature_url: savedIdentitySettings.signatureUrl,
    });
  }
  setIdentityEditing(false);
  setHeaderSaveStatus("Perubahan dibatalkan. Identitas tersimpan tidak berubah.");
});

logoInput.addEventListener("change", () => {
  saveIdentityImage(logoInput, document.querySelector("#preview-logo"), document.querySelector("#logo-wrap"), "logo");
});

signatureInput.addEventListener("change", () => {
  saveIdentityImage(
    signatureInput,
    document.querySelector("#preview-signature"),
    document.querySelector("#signature-wrap"),
    "signature",
  );
});

document.querySelector("#receipt-form").addEventListener("submit", event => event.preventDefault());

document.querySelector("#admin-login-button").addEventListener("click", async () => {
  const email = document.querySelector("#admin-email").value.trim();
  const password = document.querySelector("#admin-password").value;
  if (!email || !password) {
    document.querySelector("#admin-session-status").textContent = "Masukkan email dan kata sandi admin.";
    return;
  }

  const button = document.querySelector("#admin-login-button");
  button.disabled = true;
  document.querySelector("#admin-session-status").textContent = "Sedang masuk…";
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentSession = data.session;
    updateAdminUi();
    setHeaderSaveStatus("Berhasil masuk. Buka identitas untuk mengedit dan menyimpan perubahan.");
  } catch (error) {
    document.querySelector("#admin-session-status").textContent = `Gagal masuk: ${error.message || "periksa koneksi dan akun admin."}`;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-logout-button").addEventListener("click", async () => {
  try {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    currentSession = null;
    updateAdminUi();
    setHeaderSaveStatus("Anda sudah keluar. Identitas tetap tampil untuk semua pengunjung.");
  } catch (error) {
    document.querySelector("#admin-session-status").textContent = `Gagal keluar: ${error.message || "periksa koneksi."}`;
  }
});

setTodayDate();
addItem("BATRIA PUTRA", "13", "1 Okt 2026", "KK", 25000);
addItem("GIFAR AZAR", "19", "1 Okt 2026", "KK", 25000);
addItem("NUR TAHMAD FADILA", "76", "1 Okt 2026", "KK", 25000);
updatePreview();
initializeSupabase();
