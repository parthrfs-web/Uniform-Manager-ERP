let state = null;
let employeeFilter = "";
let pendingInspection = null;
let selectedSheetName = null;
let editingPolicyId = null;
let editingItemId = null;
let reviewFilter = "All";
let pendingReviewDecision = null;
let selectedPolicyUnit = null;
let policySearch = "";
let distributionLimit = 20000;
let pendingDistributionEdit = null;
let currentPreviewData = null;
let selectedReviewEmployee = null;
let reviewSearchText = "";
let summaryCache = [];
let currentStage2Items = [];
let currentEmpData = null;

let progressTimer = null;
let progressStartTime = 0;

const desktopApi = window.uniformManager;
