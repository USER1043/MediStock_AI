# Changelog

## [1.2.1](https://github.com/USER1043/MediStock_AI/compare/frontend-v1.2.0...frontend-v1.2.1) (2026-10-25)


### Bug Fixes

* **billing:** atomic FEFO batch deduction with transaction and compensating rollback ([1d1121f](https://github.com/USER1043/MediStock_AI/commit/1d1121ff550a64cb8dd51ef0b749a8feeb4f49b5))

## [1.2.0](https://github.com/USER1043/MediStock_AI/compare/frontend-v1.1.0...frontend-v1.2.0) (2026-07-28)


### Features

* **forecast:** update recommendation status handling and continuous trend data in forecastController ([2bd7894](https://github.com/USER1043/MediStock_AI/commit/2bd789489c2c4b137711598600b36125008a75b0))
* **reports:** connect FinancialReports page to live backend sales and purchase APIs ([2f7d151](https://github.com/USER1043/MediStock_AI/commit/2f7d1514ad9d7b0622bc60c20b7e5c5efcf5564c))
* **schema:** update PurchaseOrder status enum to include Adjusted and standardize priority levels ([4640236](https://github.com/USER1043/MediStock_AI/commit/4640236b40a461e1bb16691107382681042ec652))
* **seeder:** add seedTemporal script to refresh time-sensitive analytics without wiping core entities ([7d24e25](https://github.com/USER1043/MediStock_AI/commit/7d24e25f39c83f5bf59085701c6968af4649c18e))


### Bug Fixes

* **deployment:** add vercel.json and _redirects SPA rewrite configuration pointing to index.html ([ecf1792](https://github.com/USER1043/MediStock_AI/commit/ecf1792d4f2179756027b76979bd49bd7fd896b3))
* **forecast:** fix ForecastReview layout alignment, status actions, priority select, and cost calculation ([47835e6](https://github.com/USER1043/MediStock_AI/commit/47835e65acf85116ec4c97a75b7833967cb7b65b))
* **inventory:** display EXPIRED status badge in expiry column for expired stock ([24362ef](https://github.com/USER1043/MediStock_AI/commit/24362efae3aad9409390db716052dbcfa07f077e))

## [1.1.0](https://github.com/USER1043/Fullstack_Pharma_project/compare/frontend-v1.0.0...frontend-v1.1.0) (2026-06-01)


### Features

* Add comprehensive Tamil Text-to-Speech (TTS) utility with phonetic fallback support ([946c7be](https://github.com/USER1043/Fullstack_Pharma_project/commit/946c7bee6924ea1ef8e2ff65a931c269f2830444))
* Add medicine inventory management with dedicated API, UI, and supplier seeding. ([28c56c2](https://github.com/USER1043/Fullstack_Pharma_project/commit/28c56c2f2c9bf384e38fd3870b7a2041ee0b8382))
* Add notification routes, enhance inventory intelligence, and simplify login page by removing role selection and demo credentials. ([88339fb](https://github.com/USER1043/Fullstack_Pharma_project/commit/88339fb9901d7688c880ff024959ad5143f80513))
* Added 2fa using TOTP based authentication ([3067931](https://github.com/USER1043/Fullstack_Pharma_project/commit/306793185868dfda55de985972aeee00d6e855dd))
* Added About Page ([ca9534e](https://github.com/USER1043/Fullstack_Pharma_project/commit/ca9534ef8ee3dd281ba4db75c53530153f50339b))
* Added Actual dashboard and analytics , removing the earlier mock UI ([ac02704](https://github.com/USER1043/Fullstack_Pharma_project/commit/ac02704b1aa97151a8b7d2be6b4443d07e50599d))
* Added Actual Dashboard UI with charts , alerts and KPI's ([695b711](https://github.com/USER1043/Fullstack_Pharma_project/commit/695b7117719f179e37eaf606691676bd45ae018c))
* Added audit log and activity log to the system, with DB seeding data files ([cbd05f7](https://github.com/USER1043/Fullstack_Pharma_project/commit/cbd05f78e1c8310911cb8433648867445dbcc93e))
* Added Integration Testing to specifically the /api/uploads/excel API ([2d14229](https://github.com/USER1043/Fullstack_Pharma_project/commit/2d142291dd6df46cb92c49be449673896b8d937c))
* Added Landing Page ([81a75b8](https://github.com/USER1043/Fullstack_Pharma_project/commit/81a75b8e1f952a0e5ff12ea2a430c0b24691cdd6))
* added logo to the website for branding ([411d784](https://github.com/USER1043/Fullstack_Pharma_project/commit/411d7843ab3423abb6322602f27ea6691cd923ee))
* Added Server CORS logging for better error handling ([6234613](https://github.com/USER1043/Fullstack_Pharma_project/commit/62346139a9663ae6274004671b3b7ab117e43915))
* Complete SRS implementation - Voice billing, prescription workflow, orders, notifications, PDF generation, financial reports, voice chatbot with Tamil support ([c33c543](https://github.com/USER1043/Fullstack_Pharma_project/commit/c33c5438f6b91c4bc832a1bc2ffdb0ed78f218bc))
* Enhance chatbot responses - add 15+ new intent handlers with detailed inventory information ([c790a2f](https://github.com/USER1043/Fullstack_Pharma_project/commit/c790a2fb21106337a709b33efe0eb8b4cc3b48c4))
* Implement add customer functionality with a modal form, including new state management and form handling. ([a93e280](https://github.com/USER1043/Fullstack_Pharma_project/commit/a93e2809cca780d813d308909df359ffa0337bce))
* Implement category management with dedicated routes, controller, and integration into supplier and medicine models. ([16f03ba](https://github.com/USER1043/Fullstack_Pharma_project/commit/16f03ba26e9f019bb549456a5ad9da0f79c768b8))
* Implement LSTM-based demand forecasting using TensorFlow.js, replacing Holt-Winters in demand prediction, and add corresponding accuracy tests. ([2fac800](https://github.com/USER1043/Fullstack_Pharma_project/commit/2fac800a6da30dc9362f98a01bc4ff297cfcd5c5))
* Improved the Chatbot Capability by adding context memory for better response and improved the backend data pipeline ([560a827](https://github.com/USER1043/Fullstack_Pharma_project/commit/560a827abed0fc38a4255ad9073243ac8c0f0ede))
* Integrate API calls with Axios for data fetching and authentication, replacing mock data and enhancing medicine search. ([32bc739](https://github.com/USER1043/Fullstack_Pharma_project/commit/32bc73969fb9c8d4486cb4bc4dc98abdcbfb4c8f))
* Integrate Google Gemini API for AI-powered smart chatbot responses with fallback support ([4c3b900](https://github.com/USER1043/Fullstack_Pharma_project/commit/4c3b900ec89f15d41ce625de5f3a736d72b98352))
* Integrate live inventory data into chatbot responses and add file cleanup with expiry alerts to medicine upload. ([ca7754f](https://github.com/USER1043/Fullstack_Pharma_project/commit/ca7754f0c914cf1c9ac97ba0863b2f92a8c6f542))
* **models:** extract schemas into individual dedicated model files ([f10ad97](https://github.com/USER1043/Fullstack_Pharma_project/commit/f10ad972c931e26488ecb0c2924829ef1d3fa97c))
* Module 8 - User & Role Management with clinic-specific permissions ([6def0b1](https://github.com/USER1043/Fullstack_Pharma_project/commit/6def0b1d7a269828a81846e43a84c1aba7288e88))
* Removed the harcoded url to make frontend and backend modular ([dece326](https://github.com/USER1043/Fullstack_Pharma_project/commit/dece3261626b72c51e3a61eebe91afdc0ef06fd3))


### Bug Fixes

* added frontend api in cors settings ([d863be6](https://github.com/USER1043/Fullstack_Pharma_project/commit/d863be624dfa88e7ecf1bcef97343636f1b613d4))
* Dashboard for non admin users ([6334092](https://github.com/USER1043/Fullstack_Pharma_project/commit/63340926e0d42b5aaf4c2e7b78ee1c96de79dd66))
* Fixed  Walk-in and Regular Customer data handling in billing page ([aaaab88](https://github.com/USER1043/Fullstack_Pharma_project/commit/aaaab8887f9256f9362afb769a50c4be3aaa79db))
* Inventory and Medicine Page bug ([687ff14](https://github.com/USER1043/Fullstack_Pharma_project/commit/687ff14e455411f3abba5317d9d58b7766441bc2))
* Making the seed files interconnected for meaning full mock and handle customer page type bug ([4b06e44](https://github.com/USER1043/Fullstack_Pharma_project/commit/4b06e44b8124eded7f8249adae7c365fccc2f0db))
* MedicineInventory Search Bug ([71e39f9](https://github.com/USER1043/Fullstack_Pharma_project/commit/71e39f911174fee40a512f8fbf71d19594d9f783))
* middleware path bug ([1f5da3b](https://github.com/USER1043/Fullstack_Pharma_project/commit/1f5da3bc9401ba2f4442523a6c71531131b9e51f))
* Module conflict ([8d07214](https://github.com/USER1043/Fullstack_Pharma_project/commit/8d072144bb315af08374c09bc4a2d4bb68f3b73a))
* Proper seeding of synthetic data ([456cda5](https://github.com/USER1043/Fullstack_Pharma_project/commit/456cda552e2a30000e3b7936e563886ceaeb2b79))
* Remove all alert and confirm dialogs for silent operation ([a2ffd99](https://github.com/USER1043/Fullstack_Pharma_project/commit/a2ffd9966043351012f6969ea39e8b1f63e70963))
* Removed admins ability to deactivate or remove another admin ([2736edf](https://github.com/USER1043/Fullstack_Pharma_project/commit/2736edf7f5e13ba689f12d6228bf0602ba66468e))
* removing hardcoded url in api.js ([237d8ea](https://github.com/USER1043/Fullstack_Pharma_project/commit/237d8ea7d4b6c89c3b9ae71cda257180c810b609))
* Show AI-generated responses only and speak only on voice input ([ba0d34a](https://github.com/USER1043/Fullstack_Pharma_project/commit/ba0d34af143c935ef596a97bf2283481668b19a6))
* update the Medicine Inventory Page to handle axios errors ([80047f8](https://github.com/USER1043/Fullstack_Pharma_project/commit/80047f8ca4e3864ca16fcd31ffcb7514ae37800d))
* updated the docker file to secure the ports and remove harcorded credentials ([d733f95](https://github.com/USER1043/Fullstack_Pharma_project/commit/d733f95076e176b1d9d771bd4708cc9d9a51720d))
* Updated the layout for correcting the navigation buttons and removed it from dashboard, also fixed order form and order history page bug ([da29518](https://github.com/USER1043/Fullstack_Pharma_project/commit/da2951869a77a310e92d797f9dbdb33adc074e1d))
* updated the seed file to proper passwords ([39ed3c1](https://github.com/USER1043/Fullstack_Pharma_project/commit/39ed3c13f608abb74579aafd34b6e5294a28708a))
* updated the server.js ([a9b94e6](https://github.com/USER1043/Fullstack_Pharma_project/commit/a9b94e6aa09ad3faf6685a54784df87f565d2d20))
* visualizations in reports page not showing even though data existed ([c4cf7b1](https://github.com/USER1043/Fullstack_Pharma_project/commit/c4cf7b1f8c974d79ef9d39a4514030733a2bb18d))
