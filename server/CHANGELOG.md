# Changelog

## [1.2.1](https://github.com/USER1043/MediStock_AI/compare/backend-v1.2.0...backend-v1.2.1) (2026-10-25)


### Bug Fixes

* **billing:** atomic FEFO batch deduction with transaction and compensating rollback ([1d1121f](https://github.com/USER1043/MediStock_AI/commit/1d1121ff550a64cb8dd51ef0b749a8feeb4f49b5))

## [1.2.0](https://github.com/USER1043/MediStock_AI/compare/backend-v1.1.0...backend-v1.2.0) (2026-07-28)


### Features

* **forecast:** update recommendation status handling and continuous trend data in forecastController ([2bd7894](https://github.com/USER1043/MediStock_AI/commit/2bd789489c2c4b137711598600b36125008a75b0))
* **schema:** update PurchaseOrder status enum to include Adjusted and standardize priority levels ([4640236](https://github.com/USER1043/MediStock_AI/commit/4640236b40a461e1bb16691107382681042ec652))
* **seeder:** add seedTemporal script to refresh time-sensitive analytics without wiping core entities ([7d24e25](https://github.com/USER1043/MediStock_AI/commit/7d24e25f39c83f5bf59085701c6968af4649c18e))

## [1.1.0](https://github.com/USER1043/Fullstack_Pharma_project/compare/backend-v1.0.0...backend-v1.1.0) (2026-06-01)


### Features

* Add medicine inventory management with dedicated API, UI, and supplier seeding. ([28c56c2](https://github.com/USER1043/Fullstack_Pharma_project/commit/28c56c2f2c9bf384e38fd3870b7a2041ee0b8382))
* Add notification routes, enhance inventory intelligence, and simplify login page by removing role selection and demo credentials. ([88339fb](https://github.com/USER1043/Fullstack_Pharma_project/commit/88339fb9901d7688c880ff024959ad5143f80513))
* Added 2fa using TOTP based authentication ([3067931](https://github.com/USER1043/Fullstack_Pharma_project/commit/306793185868dfda55de985972aeee00d6e855dd))
* Added Actual dashboard and analytics , removing the earlier mock UI ([ac02704](https://github.com/USER1043/Fullstack_Pharma_project/commit/ac02704b1aa97151a8b7d2be6b4443d07e50599d))
* Added Actual Dashboard UI with charts , alerts and KPI's ([695b711](https://github.com/USER1043/Fullstack_Pharma_project/commit/695b7117719f179e37eaf606691676bd45ae018c))
* Added audit log and activity log to the system, with DB seeding data files ([cbd05f7](https://github.com/USER1043/Fullstack_Pharma_project/commit/cbd05f78e1c8310911cb8433648867445dbcc93e))
* Added Integration Testing to specifically the /api/uploads/excel API ([2d14229](https://github.com/USER1043/Fullstack_Pharma_project/commit/2d142291dd6df46cb92c49be449673896b8d937c))
* Added Server CORS logging for better error handling ([6234613](https://github.com/USER1043/Fullstack_Pharma_project/commit/62346139a9663ae6274004671b3b7ab117e43915))
* Complete SRS implementation - Voice billing, prescription workflow, orders, notifications, PDF generation, financial reports, voice chatbot with Tamil support ([c33c543](https://github.com/USER1043/Fullstack_Pharma_project/commit/c33c5438f6b91c4bc832a1bc2ffdb0ed78f218bc))
* Implement category management with dedicated routes, controller, and integration into supplier and medicine models. ([16f03ba](https://github.com/USER1043/Fullstack_Pharma_project/commit/16f03ba26e9f019bb549456a5ad9da0f79c768b8))
* Implement LSTM-based demand forecasting using TensorFlow.js, replacing Holt-Winters in demand prediction, and add corresponding accuracy tests. ([2fac800](https://github.com/USER1043/Fullstack_Pharma_project/commit/2fac800a6da30dc9362f98a01bc4ff297cfcd5c5))
* Improved the Chatbot Capability by adding context memory for better response and improved the backend data pipeline ([560a827](https://github.com/USER1043/Fullstack_Pharma_project/commit/560a827abed0fc38a4255ad9073243ac8c0f0ede))
* Integrate API calls with Axios for data fetching and authentication, replacing mock data and enhancing medicine search. ([32bc739](https://github.com/USER1043/Fullstack_Pharma_project/commit/32bc73969fb9c8d4486cb4bc4dc98abdcbfb4c8f))
* Integrate live inventory data into chatbot responses and add file cleanup with expiry alerts to medicine upload. ([ca7754f](https://github.com/USER1043/Fullstack_Pharma_project/commit/ca7754f0c914cf1c9ac97ba0863b2f92a8c6f542))
* **models:** extract schemas into individual dedicated model files ([f10ad97](https://github.com/USER1043/Fullstack_Pharma_project/commit/f10ad972c931e26488ecb0c2924829ef1d3fa97c))
* Module 8 - User & Role Management with clinic-specific permissions ([6def0b1](https://github.com/USER1043/Fullstack_Pharma_project/commit/6def0b1d7a269828a81846e43a84c1aba7288e88))
* Removed the harcoded url to make frontend and backend modular ([dece326](https://github.com/USER1043/Fullstack_Pharma_project/commit/dece3261626b72c51e3a61eebe91afdc0ef06fd3))


### Bug Fixes

* added frontend api in cors settings ([d863be6](https://github.com/USER1043/Fullstack_Pharma_project/commit/d863be624dfa88e7ecf1bcef97343636f1b613d4))
* Dashboard for non admin users ([6334092](https://github.com/USER1043/Fullstack_Pharma_project/commit/63340926e0d42b5aaf4c2e7b78ee1c96de79dd66))
* Fixed  Walk-in and Regular Customer data handling in billing page ([aaaab88](https://github.com/USER1043/Fullstack_Pharma_project/commit/aaaab8887f9256f9362afb769a50c4be3aaa79db))
* Making the seed files interconnected for meaning full mock and handle customer page type bug ([4b06e44](https://github.com/USER1043/Fullstack_Pharma_project/commit/4b06e44b8124eded7f8249adae7c365fccc2f0db))
* MedicineInventory Search Bug ([71e39f9](https://github.com/USER1043/Fullstack_Pharma_project/commit/71e39f911174fee40a512f8fbf71d19594d9f783))
* middleware path bug ([1f5da3b](https://github.com/USER1043/Fullstack_Pharma_project/commit/1f5da3bc9401ba2f4442523a6c71531131b9e51f))
* Proper seeding of synthetic data ([456cda5](https://github.com/USER1043/Fullstack_Pharma_project/commit/456cda552e2a30000e3b7936e563886ceaeb2b79))
* Removed admins ability to deactivate or remove another admin ([2736edf](https://github.com/USER1043/Fullstack_Pharma_project/commit/2736edf7f5e13ba689f12d6228bf0602ba66468e))
* updated the seed file to proper passwords ([39ed3c1](https://github.com/USER1043/Fullstack_Pharma_project/commit/39ed3c13f608abb74579aafd34b6e5294a28708a))
* updated the server.js ([a9b94e6](https://github.com/USER1043/Fullstack_Pharma_project/commit/a9b94e6aa09ad3faf6685a54784df87f565d2d20))
