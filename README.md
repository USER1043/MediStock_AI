# MediStock AI

A clinical-grade, full-stack pharmacy inventory and management system built with React 18, Node.js, Express, and MongoDB. MediStock AI transitions traditional pharmacy tracking into a proactive, intelligent ecosystem using local machine learning forecasting, context-aware LLM agents, and robust multi-batch ledgers.

---

## Core Features and Owner Benefits

### 1. Smart Purchase Auto-Drafts (No More Stockouts or Dead Stock)
* **The Technology**: Powered by local **TensorFlow.js (LSTM Recurrent Neural Networks)** and Holt-Winters smoothing.
* **How it helps you**: The system automatically analyzes your last 90 days of sales to predict exactly how much of each medicine you will need in the coming weeks. It then **automatically drafts purchase orders** for your suppliers, taking the guesswork out of ordering, preventing empty shelves, and saving you from tying up cash in unsold "dead stock."

### 2. Hands-Free Bilingual Voice Assistant (Instant Stock Answers)
* **The Technology**: Powered by a secure backend integration with **Google Gemini 2.0 Flash**.
* **How it helps you**: When your hands are full assisting customers or counting inventory, you and your staff can simply **speak to the system** in English or Tamil. Ask questions like *"Where is Paracetamol?"* or *"What is expiring soon?"*, and the chatbot will instantly retrieve the exact batch, current stock level, and rack location for you.

### 3. High-Accessibility Tamil Speech (Works on Any Device)
* **The Technology**: Custom Tamil Unicode-to-English phonetic character mapping engine.
* **How it helps you**: You don’t need to buy expensive, high-end computers for your shop. Our custom phonetic mapping engine ensures the Tamil voice assistant works smoothly and speaks clearly on **any device** (smartphones, cheap tablets, or old PCs) - even if the device does not natively support Tamil system voices.

### 4. FEFO-Driven Batch Tracking (Drastically Reduce Expired Waste)
* **The Technology**: Multi-batch ledger with automatic **First-Expired, First-Out (FEFO)** sorting.
* **How it helps you**: Stop losing money to expired medicines. The system tracks products by batch number, specific shelf/rack location, and expiry date. When generating a bill, **it automatically suggests stock from the batch closest to expiry first**, making sure you sell older inventory before it goes to waste.

### 5. Secure Prescription & Order Workflow (Expand Your Shop Online)
* **The Technology**: Secure image upload (via Multer), dynamic status pipelines, and automated Twilio WhatsApp / Nodemailer email notifications.
* **How it helps you**: Modernize your pharmacy by letting customers securely upload photos of their prescriptions online. You can quickly review, approve, or reject uploads from a clean dashboard. Once approved, the system **automatically alerts the customer via WhatsApp and email**, keeping them informed and driving higher customer satisfaction.

---

## Technology Stack

* **Frontend**: React 18, Vite, Tailwind CSS, Material UI (MUI), Recharts
* **Backend**: Node.js, Express, Mongoose (MongoDB Atlas / Docker Compose)
* **AI & NLP**: TensorFlow.js, Google Gemini 2.0 Flash, Web Speech API (TTS/STT)
* **Integrations**: Twilio API (WhatsApp), Nodemailer, PDFKit (Invoice Generation)
* **Testing**: Jest, Supertest

---

## Documentation

Developer documentation lives in [`docs/`](docs/README.md): architecture and diagrams, core business flows, backend and frontend structure, data model, security, forecasting, the chatbot, the API reference, setup and deployment, and the architecture decision records. Start with [`docs/architecture.md`](docs/architecture.md).

---

## Getting Started

### Prerequisites
* Node.js (v18 or later)
* MongoDB (Atlas or local Docker instance)

### Setup & Installation

1. **Clone and Install Dependencies:**
   ```bash
   git clone https://github.com/USER1043/MediStock_AI.git
   cd MediStock_AI
   npm install
   cd server && npm install
   ```

2. **Configure Environment Variables:**

   * **Root Directory `.env`** (for Frontend configuration & local Docker Compose):
     ```env
     VITE_API_BASE_URL="http://localhost:5000/api"
     
     # MongoDB Root Credentials for Local Docker Compose
     MONGO_ROOT_USER="admin"
     MONGO_ROOT_PASSWORD="super_secret_password"
     ```

   * **Backend Directory `server/.env`** (for secure keys - never exposed to the client):
     ```env
     PORT=5000
     NODE_ENV=development
     MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/medistock
     JWT_SECRET=your_jwt_secret_key
     FRONTEND_URL=http://localhost:5173   # required: comma-separated CORS allow-list
     
     # Secure AI Integrations
     GEMINI_API_KEY=your_google_gemini_api_key
     
     # Notifications & Messaging
     EMAIL_USER=your_gmail@gmail.com
     EMAIL_PASSWORD=your_app_password
     TWILIO_ACCOUNT_SID=your_twilio_sid
     TWILIO_AUTH_TOKEN=your_twilio_token
     ```

3. **Run the Application:**
   ```bash
   # Terminal 1 - Frontend Dev Server
   npm run dev

   # Terminal 2 - Express API Server
   cd server
   npm run dev
   ```

4. **Verify with Tests:**
   ```bash
   cd server
   npm test
   ```

---

## Contributing

Contributions are welcome to help improve MediStock AI. To contribute:
1. Fork the repository and create a new feature branch (`feature/your-feature-name`).
2. Adhere to our FEFO batch management, secure backend proxy, and MERN design patterns.
3. Ensure all backend changes are validated by running `npm test` (Jest & Supertest).
4. Open a Pull Request detailing your changes and verification steps.

---

## License

This project is licensed under the MIT License.
