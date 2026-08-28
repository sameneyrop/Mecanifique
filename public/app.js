const state = {
  token: localStorage.getItem("mecanifiqueToken") || "",
  user: JSON.parse(localStorage.getItem("mecanifiqueUser") || "null")
};

const authChip = document.getElementById("authChip");
const authOutput = document.getElementById("authOutput");
const requestOutput = document.getElementById("requestOutput");
const mechanicsList = document.getElementById("mechanicsList");
const requestDetails = document.getElementById("requestDetails");
const actionOutput = document.getElementById("actionOutput");

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("mecanifiqueToken", token);
  localStorage.setItem("mecanifiqueUser", JSON.stringify(user));
  renderAuth();
}

function clearAuth() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("mecanifiqueToken");
  localStorage.removeItem("mecanifiqueUser");
  renderAuth();
}

function renderAuth() {
  authChip.textContent = state.user ? `${state.user.role} · ${state.user.fullName}` : "Sin sesión";
}

async function request(path, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof payload === "string" ? payload : payload.error || "Error inesperado";
    throw new Error(message);
  }

  return payload;
}

function jsonOutput(el, data) {
  el.textContent = JSON.stringify(data, null, 2);
}

function parseSpecialties(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    login: form.login.value,
    password: form.password.value
  };

  try {
    const data = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setAuth(data.token, data.user);
    jsonOutput(authOutput, data);
  } catch (error) {
    authOutput.textContent = error.message;
  }
});

document.querySelectorAll("button[data-mode]").forEach((button) => {
  button.addEventListener("click", async () => {
    const mode = button.dataset.mode;
    const isMechanic = mode === "mechanic-register";
    const fullName = prompt("Nombre completo");
    const phone = prompt("Teléfono");
    const password = prompt("Contraseña (mínimo 8 caracteres)");

    if (!fullName || !phone || !password) {
      return;
    }

    try {
      const endpoint = isMechanic ? "/auth/register/mechanic" : "/auth/register/customer";
      const body = isMechanic
        ? {
            fullName,
            phone,
            password,
            city: prompt("Ciudad") || "Aguascalientes",
            zone: prompt("Zona") || "Centro",
            yearsExperience: Number(prompt("Años de experiencia") || "0"),
            specialties: parseSpecialties(prompt("Especialidades separadas por coma") || "General")
          }
        : { fullName, phone, password };

      const data = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(body)
      });
      setAuth(data.token, data.user);
      jsonOutput(authOutput, data);
    } catch (error) {
      authOutput.textContent = error.message;
    }
  });
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  clearAuth();
  authOutput.textContent = "Sesión cerrada";
});

document.getElementById("requestForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  const payload = {
    customerId: form.customerId.value ? Number(form.customerId.value) : undefined,
    vehicleMake: form.vehicleMake.value,
    vehicleModel: form.vehicleModel.value,
    vehicleYear: Number(form.vehicleYear.value),
    issueDescription: form.issueDescription.value,
    preferredTime: form.preferredTime.value,
    city: form.city.value,
    zone: form.zone.value
  };

  try {
    const data = await request("/api/service-requests", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    jsonOutput(requestOutput, data);
  } catch (error) {
    requestOutput.textContent = error.message;
  }
});

async function loadMechanics(query = "") {
  const data = await request(`/mechanics${query}`);
  mechanicsList.innerHTML = data
    .map((mechanic) => {
      const specialties = Array.isArray(mechanic.specialties) ? mechanic.specialties.join(", ") : mechanic.specialties;
      return `
        <div class="item">
          <strong>${mechanic.fullName}</strong>
          <div>${mechanic.city} · ${mechanic.zone}</div>
          <div>${specialties}</div>
          <div class="tag">#${mechanic.id} · ${mechanic.status} · ${mechanic.isAvailable ? "disponible" : "ocupado"}</div>
        </div>
      `;
    })
    .join("");
}

document.getElementById("mechanicsFilter").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const params = new URLSearchParams();
  if (form.city.value) params.set("city", form.city.value);
  if (form.zone.value) params.set("zone", form.zone.value);
  try {
    await loadMechanics(params.toString() ? `?${params.toString()}` : "");
  } catch (error) {
    mechanicsList.innerHTML = `<div class="item">${error.message}</div>`;
  }
});

document.getElementById("requestLookup").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const data = await request(`/service-requests/${form.id.value}`);
    requestDetails.innerHTML = `
      <div class="item">
        <strong>Solicitud #${data.id}</strong>
        <div>${data.vehicleMake} ${data.vehicleModel} ${data.vehicleYear}</div>
        <div>${data.city} · ${data.zone}</div>
        <div>Estado: ${data.status}</div>
        <div>Mecánico: ${data.mechanicName || "sin asignar"}</div>
        <div class="muted">${data.issueDescription}</div>
      </div>
      <pre class="output">${JSON.stringify(data.updates, null, 2)}</pre>
    `;
  } catch (error) {
    requestDetails.innerHTML = `<div class="item">${error.message}</div>`;
  }
});

document.getElementById("assignForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {};
  if (form.mechanicId.value) body.mechanicId = Number(form.mechanicId.value);

  try {
    const data = await request(`/api/service-requests/${form.requestId.value}/assign`, {
      method: "POST",
      body: JSON.stringify(body)
    });
    jsonOutput(actionOutput, data);
  } catch (error) {
    actionOutput.textContent = error.message;
  }
});

document.getElementById("statusForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const data = await request(`/api/mechanics/${form.mechanicId.value}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: form.status.value })
    });
    jsonOutput(actionOutput, data);
  } catch (error) {
    actionOutput.textContent = error.message;
  }
});

document.getElementById("availabilityForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const data = await request(`/api/mechanics/${form.mechanicId.value}/availability`, {
      method: "PATCH",
      body: JSON.stringify({ isAvailable: form.isAvailable.value === "true" })
    });
    jsonOutput(actionOutput, data);
  } catch (error) {
    actionOutput.textContent = error.message;
  }
});

document.getElementById("updateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    const data = await request(`/api/service-requests/${form.requestId.value}/updates`, {
      method: "POST",
      body: JSON.stringify({ source: "mechanic", message: form.message.value })
    });
    jsonOutput(actionOutput, data);
  } catch (error) {
    actionOutput.textContent = error.message;
  }
});

renderAuth();
loadMechanics().catch((error) => {
  mechanicsList.innerHTML = `<div class="item">${error.message}</div>`;
});
