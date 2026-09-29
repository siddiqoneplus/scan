const fs = require('fs');

let index = fs.readFileSync('index.html', 'utf8');

// 1. Add Subject & Employee Filters + End Date
const oldFilters = `
            <div class="flex-gap-xs">
              <input type="date" id="analyticsFilterDate" class="input-styled analytics-date-picker" title="Filter Attendance by Date" aria-label="Filter Attendance by Date" placeholder="YYYY-MM-DD">
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.clearAnalyticsDateFilter()" title="Show records from all dates">
                <i class="fa-solid fa-calendar-xmark"></i> All Dates
              </button>
            </div>
            
            <input type="text" id="analyticsSearch" class="input-styled" placeholder="Filter by roll number or name..." title="Filter by roll number or name">
`;

const newFilters = `
            <div class="flex-gap-xs" style="grid-column: 1 / -1; flex-wrap: wrap;">
              <input type="date" id="analyticsFilterStartDate" class="input-styled analytics-date-picker" title="Start Date" aria-label="Start Date">
              <span style="color:#a4b0be; align-self:center;">to</span>
              <input type="date" id="analyticsFilterEndDate" class="input-styled analytics-date-picker" title="End Date" aria-label="End Date">
              <button type="button" class="btn btn-secondary btn-sm" onclick="App.clearAnalyticsDateFilter()" title="Clear Dates">
                <i class="fa-solid fa-calendar-xmark"></i> Clear
              </button>
            </div>
            
            <input type="text" id="analyticsSearch" class="input-styled" placeholder="Filter by roll number or name..." title="Filter by roll number or name">
            <input type="text" id="analyticsFilterSubject" class="input-styled" placeholder="Filter Subject..." title="Filter Subject">
            <input type="text" id="analyticsFilterEmployee" class="input-styled" placeholder="Filter Employee..." title="Filter Employee">
`;

index = index.replace(oldFilters, newFilters);

// 2. Add Subject to Table Header
const oldTableHeader = `
                <th class="col-w-50">#</th>
                <th>Roll Number</th>
                <th>Student Name</th>
                <th>Branch</th>
                <th>Year</th>
                <th>Section</th>
                <th>Check-in Time</th>
                <th>Marked By</th>
                <th class="text-right admin-only-el">Action</th>
`;

const newTableHeader = `
                <th class="col-w-50">#</th>
                <th>Roll Number</th>
                <th>Student Name</th>
                <th>Section</th>
                <th>Subject</th>
                <th>Date</th>
                <th>Status</th>
                <th>Scan Time</th>
                <th>Employee</th>
                <th class="text-right admin-only-el">Action</th>
`;

index = index.replace(oldTableHeader, newTableHeader);

// 3. Add Pagination Controls Below Table
const oldTableEnd = `
        <!-- Attendance Records Table -->
        <div class="table-container">
          <table class="custom-table" id="analyticsTable">
            <thead>
`;

// Insert empty state inside tbody, and pagination after table-container
const newTableEnd = `
        <!-- Attendance Records Table -->
        <div class="table-container">
          <table class="custom-table" id="analyticsTable">
`;
index = index.replace(oldTableEnd, newTableEnd);

const paginationHTML = `
        </div>
        
        <!-- Pagination Controls -->
        <div id="analyticsPagination" style="display: flex; justify-content: space-between; align-items: center; padding: 15px 0; border-top: 1px solid rgba(255,255,255,0.1);">
           <div style="color: #a4b0be; font-size: 0.9rem;">
             Showing <span id="pageStart">0</span>-<span id="pageEnd">0</span> of <span id="pageTotal">0</span>
           </div>
           <div class="flex-gap-xs">
             <button class="btn btn-secondary btn-sm" id="btnPagePrev" onclick="App.changeAnalyticsPage(-1)"><i class="fa-solid fa-chevron-left"></i> Prev</button>
             <span style="padding: 0 10px; align-self: center;" id="pageIndicator">Page 1 / 1</span>
             <button class="btn btn-secondary btn-sm" id="btnPageNext" onclick="App.changeAnalyticsPage(1)">Next <i class="fa-solid fa-chevron-right"></i></button>
           </div>
        </div>
        
        <div id="analyticsEmptyState" style="display: none; text-align: center; padding: 40px; color: #a4b0be;">
           <i class="fa-solid fa-folder-open fa-3x mb-3" style="color: rgba(255,255,255,0.1);"></i>
           <h3 style="color: var(--text-main);">No records found</h3>
           <p>Try adjusting your filters or date range.</p>
        </div>
`;

index = index.replace('        </div>\n      </div>\n    </section>', paginationHTML + '\n      </div>\n    </section>');

fs.writeFileSync('index.html', index);
console.log('Patched index.html');
