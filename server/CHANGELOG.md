# Changelog

## [1.3.0](https://github.com/USER1043/MediStock_AI/compare/backend-v1.2.1...backend-v1.3.0) (2026-11-23)


### Features

* **alerts:** generate alerts lazily, clear them automatically, treat resolve as acknowledge ([d88a9f5](https://github.com/USER1043/MediStock_AI/commit/d88a9f5d5c99411ecb74696767acc7c3bf257dc1))
* **alerts:** raise one near_expiry/expired alert per batch ([4e35596](https://github.com/USER1043/MediStock_AI/commit/4e35596d86d6f3696e85d0329f156205eeb055e9))
* **alerts:** re-raise an acknowledged batch alert when its expiry date is edited ([276fc61](https://github.com/USER1043/MediStock_AI/commit/276fc6160d7cd7615512ce3a3e1ccb181f75e9ca))
* **auth:** enforce a password policy for new passwords ([c4f87e0](https://github.com/USER1043/MediStock_AI/commit/c4f87e02e79bba10d5bfb347e80e046aed5d7a02))
* **chatbot:** answer in one call, race a second model, answer offline correctly ([2682c38](https://github.com/USER1043/MediStock_AI/commit/2682c384af5eb7d9908019d54887f489102437f3))
* **chatbot:** look up inventory with tool calls instead of sending all of it ([c1f2e3f](https://github.com/USER1043/MediStock_AI/commit/c1f2e3f6801d974e330cd7bcafd59e7834c8cb1a))
* **docker:** build and run the web app, API and an optional MongoDB ([641050b](https://github.com/USER1043/MediStock_AI/commit/641050b63770a45d62646ff49a788c381a04ecb6))


### Bug Fixes

* **alerts:** detect near-expiry and expired stock per batch ([2ac319a](https://github.com/USER1043/MediStock_AI/commit/2ac319aba448fe5387e422169d123e97f7dff6ab))
* **alerts:** use returnDocument: 'after' in resolveAlert ([ddd09db](https://github.com/USER1043/MediStock_AI/commit/ddd09dbf3b16cbcfd5a037c96c394749aecb2a4e))
* **audit:** record the real action and full endpoint for every write ([9e4d3a1](https://github.com/USER1043/MediStock_AI/commit/9e4d3a175a4ff8628cb8755a435f932218390f9e))
* **audit:** redact secrets at any depth and by key name pattern ([1a69d71](https://github.com/USER1043/MediStock_AI/commit/1a69d7187acf34b7ac86c4523fab6846b97c5382))
* **auth:** hash new passwords in updateUser with a static bcryptjs import ([003e87b](https://github.com/USER1043/MediStock_AI/commit/003e87bb51f59db811ea20168694fbf20dcb268c))
* **auth:** keep password and twoFactorSecret out of queries and JSON ([751bfb6](https://github.com/USER1043/MediStock_AI/commit/751bfb6b590f208c1dac490caea063bfef35d523))
* **auth:** make the User pre-save hook work on Mongoose 9 ([a6a2c62](https://github.com/USER1043/MediStock_AI/commit/a6a2c629305f334fe41731177fe0d47ce66b98cd))
* **auth:** reject new passwords over 72 bytes (bcrypt's limit) ([30fc221](https://github.com/USER1043/MediStock_AI/commit/30fc2212612c7fdba3a2a756e20c0b79a0f38e79))
* **billing:** roll back a failed bill without undoing other sales ([5509e84](https://github.com/USER1043/MediStock_AI/commit/5509e84a85c3fa995bc55afda5d9ac20f3347f26))
* **chatbot:** default to gemini-3.5-flash-lite ([ea91f45](https://github.com/USER1043/MediStock_AI/commit/ea91f456f5b54e9b3bfea1a44d1c5f7efcb6aacc))
* **customers:** harden update, search and delete ([3f999ed](https://github.com/USER1043/MediStock_AI/commit/3f999ed24b978a8c0877e9f1278dc642a0226aa1))
* **expiry:** a batch expires at 00:00 IST on its expiry day ([9c2f2cd](https://github.com/USER1043/MediStock_AI/commit/9c2f2cd705dbc378c5788b91667df3e1f4977f91))
* **forecast:** make retrain owner-only and skip it for staff imports ([2880a34](https://github.com/USER1043/MediStock_AI/commit/2880a34949bddf9a2d45903931330a5476dded68))
* **forecast:** quantity-only recommendation PUT adjusts the draft; make the transition atomic ([a14b55f](https://github.com/USER1043/MediStock_AI/commit/a14b55f0a6515b69ed92b885e247d073070a08e2))
* **forecast:** save AI drafts with valid priorities and never lose old drafts ([1403db8](https://github.com/USER1043/MediStock_AI/commit/1403db82642787b259e6d99b2b795d54fd4c337f))
* **forecast:** staff review drafts, only the owner approves or deletes them ([3b842cc](https://github.com/USER1043/MediStock_AI/commit/3b842ccc748a6fc4cac6f37c7f3917249390a31a))
* **import:** report row errors and anomalies by their Excel row number ([9ed498f](https://github.com/USER1043/MediStock_AI/commit/9ed498f7902338a674cc1fc973a20ff35633c5f7))
* **import:** resolve Excel supplier names to Supplier ids and export names ([7e9155d](https://github.com/USER1043/MediStock_AI/commit/7e9155d47ad349fc66542ff17144768ccb1ee958))
* **inventory:** store medicine suppliers as supplier ids ([8c38428](https://github.com/USER1043/MediStock_AI/commit/8c38428c00b5854456fbebc0f5ee6f0a2cea2820))
* **orders:** unique bill and purchase-order numbers ([97a14b3](https://github.com/USER1043/MediStock_AI/commit/97a14b385a3e9065a646051ce313d41e7a8de564))
* **reorder:** give out-of-stock reorder drafts a valid priority ([d27121f](https://github.com/USER1043/MediStock_AI/commit/d27121f79f1a3034eb9e99a7aa8e74f9601cb97f))
* **reorders:** remove the rule-based draft generator; show live stock on drafts ([758f20f](https://github.com/USER1043/MediStock_AI/commit/758f20f2c3b41f6da25b7756089fb5638c896808))
* **seed:** never seed activity later than the moment the seed runs ([bd688d7](https://github.com/USER1043/MediStock_AI/commit/bd688d7f7044ce0505759ef8ce2fce4666ac03f5))
* **server:** hide database credentials in the start-up banner ([407f875](https://github.com/USER1043/MediStock_AI/commit/407f8759e606825d7fa71514557de3cc62712527))
* **stock:** one shared stock-level definition (out/critical/low/ok) for every low-stock path ([c885ed8](https://github.com/USER1043/MediStock_AI/commit/c885ed812704e56ec16b6acfcc7e9175b11cd476))


### Performance Improvements

* **chatbot:** spend free-tier Gemini requests only where the model is needed ([b60a8bd](https://github.com/USER1043/MediStock_AI/commit/b60a8bdcf7fd8144c8988cb37514b5cebaa9b775))

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
