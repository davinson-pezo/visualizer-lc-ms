// visualizer/app.js

// State management
let state = {
  sampleData: null,       // Active sample JS data
  selectedPeak: null,     // Selected peak object
  searchQuery: '',        // Search filter
  activeFilter: 'all',    // Active filter: 'all', 'lib', 'ms2'
  chromatogramMode: 'bpc', // Mode: 'bpc' or 'tic'
  spectraViewMode: 'spectra' // Mode: 'spectra' or '3d'
};

// DOM Elements
const sampleSelect = document.getElementById('sampleSelect');
const polarityBadge = document.getElementById('polarityBadge');
const peakCountIndicator = document.getElementById('peakCountIndicator');
const searchInput = document.getElementById('searchInput');
const peakTableBody = document.getElementById('peakTableBody');
const chromatogramIndicator = document.getElementById('chromatogramIndicator');

// BPC/TIC Toggle Buttons
const btnShowBpc = document.getElementById('btnShowBpc');
const btnShowTic = document.getElementById('btnShowTic');
const btnResetChromZoom = document.getElementById('btnResetChromZoom');
const chromSelectionSummary = document.getElementById('chromSelectionSummary');

// Detail Pane Elements
const emptyDetailsState = document.getElementById('emptyDetailsState');
const activeDetailsState = document.getElementById('activeDetailsState');
const detPeakId = document.getElementById('detPeakId');
const detRtCorrected = document.getElementById('detRtCorrected');
const detMz = document.getElementById('detMz');
const detAbundance = document.getElementById('detAbundance');
const detAdduct = document.getElementById('detAdduct');
const detMs2Status = document.getElementById('detMs2Status');
const detName = document.getElementById('detName');
const detFormula = document.getElementById('detFormula');
const detTypeBadge = document.getElementById('detTypeBadge');
const libraryMatchStats = document.getElementById('libraryMatchStats');
const detLibScore = document.getElementById('detLibScore');
const detLibError = document.getElementById('detLibError');
const detWarningsContainer = document.getElementById('detWarningsContainer');
const detWarnings = document.getElementById('detWarnings');
const detRelationsContainer = document.getElementById('detRelationsContainer');
const detRelations = document.getElementById('detRelations');

// External Links
const linkPubChem = document.getElementById('linkPubChem');
const linkGNPS = document.getElementById('linkGNPS');
const linkHMDB = document.getElementById('linkHMDB');
const linkMassBank = document.getElementById('linkMassBank');
const btnExportMsp = document.getElementById('btnExportMsp');

// Spectra Placeholders
const ms1Placeholder = document.getElementById('ms1Placeholder');
const ms2Placeholder = document.getElementById('ms2Placeholder');
const eicPlaceholder = document.getElementById('eicPlaceholder');
const fragmentMatchPanel = document.getElementById('fragmentMatchPanel');
const fragmentMatchBody = document.getElementById('fragmentMatchBody');
const btnShowSpectra = document.getElementById('btnShowSpectra');
const btnShow3D = document.getElementById('btnShow3D');
const plotly3DContainer = document.getElementById('plotly3DContainer');
const plotly3DPlaceholder = document.getElementById('plotly3DPlaceholder');

// Plotly Plot Div IDs
const CHROMATOGRAM_DIV = 'chromatogramPlot';
const MS1_DIV = 'ms1Plot';
const MS2_DIV = 'ms2Plot';
const EIC_DIV = 'eicPlot';
const PLOT_3D_DIV = 'plotly3DPlot';
const PROTON_MASS = 1.007276466621;
const FRAGMENT_MATCH_TOLERANCE_DA = 0.02;
const DATA_VERSION = '20260616-mona-mixed-ms2-only';
const ADDUCT_RULES = {
  '[M+H]+': { shift: PROTON_MASS, multimer: 1 },
  '[M]+': { shift: 0, multimer: 1 },
  '[M+NA]+': { shift: 22.989218, multimer: 1 },
  '[M+K]+': { shift: 38.963158, multimer: 1 },
  '[M+NH4]+': { shift: 18.033823, multimer: 1 },
  '[M+ACN+H]+': { shift: 42.033823, multimer: 1 },
  '[M-H]-': { shift: -PROTON_MASS, multimer: 1 },
  '[M+FA-H]-': { shift: 44.998201, multimer: 1 },
  '[M+HCOO]-': { shift: 44.998201, multimer: 1 },
  '[M+CL]-': { shift: 34.969402, multimer: 1 },
  '[2M+H]+': { shift: PROTON_MASS, multimer: 2 },
  '[2M-H]-': { shift: -PROTON_MASS, multimer: 2 }
};

function neutralMassFromPrecursorType(observedMz, precursorType) {
  if (!precursorType || !Number.isFinite(Number(observedMz))) return null;
  const normalized = precursorType.toUpperCase().replace(/\s+/g, '');
  const rule = ADDUCT_RULES[normalized];
  if (!rule) return null;
  return (Number(observedMz) - rule.shift) / rule.multimer;
}

function getPeakIonization(peak) {
  if (peak.ionization && Number.isFinite(Number(peak.ionization.neutral_mass))) {
    return {
      adduct: peak.ionization.assumed_adduct || peak.ionization.adduct || '',
      neutralMass: Number(peak.ionization.neutral_mass),
      source: peak.ionization.adduct_source || 'unknown'
    };
  }

  const isNeg = state.sampleData && state.sampleData.polarity.includes('-');
  return {
    adduct: isNeg ? '[M-H]-' : '[M+H]+',
    neutralMass: isNeg ? peak.mz + PROTON_MASS : peak.mz - PROTON_MASS,
    source: 'assumed_default'
  };
}

function getDataQualityIssues(data) {
  return data.data_quality && Array.isArray(data.data_quality.issues)
    ? data.data_quality.issues
    : [];
}

function getPeakWarnings(peak) {
  const warnings = Array.isArray(peak.warnings) ? [...peak.warnings] : [];
  return warnings;
}

function formatWarning(code) {
  const labels = {
    adduct_not_inferred: 'Adduct assumed, not inferred',
    ms2_precursor_offset: 'MS/MS precursor offset relative to the main ion',
    common_background_ion_113: 'Possible common/background ion near m/z 113'
  };
  return labels[code] || code;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getLibraryCandidate(peak) {
  const rawName = (peak.library_match && peak.library_match.name ? peak.library_match.name : '').trim();
  if (!rawName) {
    return {
      rawName: '',
      displayName: '',
      searchText: '',
      isCodedRecord: false,
      note: ''
    };
  }

  const codedPattern = /\b(NCGC|CCMSLIB|MSBNK|MASSBANK|HMDB\d|CHEBI:|PUBCHEM|IIN-based|Spectrum|untitled|unknown)\b/i;
  const startsWithLibraryCode = /^[A-Z]{2,}\d{4,}[-_!]/.test(rawName);
  const isCodedRecord = codedPattern.test(rawName) || startsWithLibraryCode;

  let displayName = rawName;
  if (isCodedRecord) {
    displayName = displayName
      .replace(/\s*\[[^\]]*(?:CCMSLIB|IIN-based)[^\]]*\]/ig, '')
      .replace(/^NCGC[0-9-]+[!_]/i, '')
      .replace(/^C\d+H\d+(?:[A-Z][a-z]?\d*)*_/, '')
      .replace(/^[_!\s-]+/, '')
      .trim();
  }

  if (!displayName || codedPattern.test(displayName)) {
    displayName = 'Unresolved library record';
  }

  return {
    rawName,
    displayName,
    searchText: `${rawName} ${displayName}`.toLowerCase(),
    isCodedRecord,
    note: isCodedRecord
      ? `Coded library record; treat as a tentative spectral annotation, not a confirmed compound name. Raw record: ${rawName}`
      : ''
  };
}

// Initialize App
window.addEventListener('DOMContentLoaded', () => {
  if (typeof Plotly === 'undefined') {
    showError(new Error("Plotly did not load. The viewer needs either Plotly CDN access or a local copy of plotly.min.js."));
    return;
  }

  loadSample(sampleSelect.value);
  
  // Set up general event listeners
  sampleSelect.addEventListener('change', (e) => loadSample(e.target.value));
  searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  
  // Set up filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      setFilter(e.target.dataset.filter);
    });
  });
  
  // Chromatogram BPC/TIC toggles
  btnShowBpc.addEventListener('click', () => {
    btnShowBpc.classList.add('active');
    btnShowTic.classList.remove('active');
    state.chromatogramMode = 'bpc';
    renderChromatogram();
  });
  
  btnShowTic.addEventListener('click', () => {
    btnShowTic.classList.add('active');
    btnShowBpc.classList.remove('active');
    state.chromatogramMode = 'tic';
    renderChromatogram();
  });

  btnResetChromZoom.addEventListener('click', resetChromatogramZoom);
  
  // Set up MSP export
  btnExportMsp.addEventListener('click', exportSelectedPeakMSP);
  
  // Set up Spectra View / 3D Peak Map toggles
  btnShowSpectra.addEventListener('click', () => {
    btnShowSpectra.classList.add('active');
    btnShow3D.classList.remove('active');
    state.spectraViewMode = 'spectra';
    
    document.querySelector('.spectra-grid').style.display = 'grid';
    document.querySelector('.reference-grid').style.display = 'block';
    plotly3DContainer.style.display = 'none';
    
    // Resize plots to ensure they fill the layout correctly
    Plotly.Plots.resize(MS1_DIV);
    Plotly.Plots.resize(MS2_DIV);
  });
  
  btnShow3D.addEventListener('click', () => {
    btnShow3D.classList.add('active');
    btnShowSpectra.classList.remove('active');
    state.spectraViewMode = '3d';
    
    document.querySelector('.spectra-grid').style.display = 'none';
    document.querySelector('.reference-grid').style.display = 'none';
    plotly3DContainer.style.display = 'block';
    
    if (state.selectedPeak) {
      render3D(state.selectedPeak);
    }
  });
});

// Load sample JS data dynamically
function loadSample(sampleName) {
  chromatogramIndicator.textContent = "Loading data...";
  chromatogramIndicator.style.color = "var(--text-secondary)";
  
  try {
    // Check if data is already loaded in global window cache
    if (window.msDataCache && window.msDataCache[sampleName]) {
      onDataLoaded(window.msDataCache[sampleName]);
      return;
    }
    
    // Create script tag to dynamically fetch the data file (bypasses CORS in file://)
    const script = document.createElement('script');
    script.src = `data/${encodeURIComponent(sampleName)}.js?v=${DATA_VERSION}`;
    script.onload = () => {
      if (window.msDataCache && window.msDataCache[sampleName]) {
        onDataLoaded(window.msDataCache[sampleName]);
      } else {
        showError(new Error("Invalid data structure in the JS file."));
      }
    };
    script.onerror = () => {
      showError(new Error(`Could not load data/${sampleName}.js. Did you run export_to_json.py?`));
    };
    document.body.appendChild(script);
    
  } catch (error) {
    showError(error);
  }
}

function showError(error) {
  console.error(error);
  chromatogramIndicator.textContent = "Loading error";
  chromatogramIndicator.style.color = "#ef4444";
  alert(`Sample data loading error: ${error.message}`);
}

function onDataLoaded(data) {
  state.sampleData = data;
  state.selectedPeak = null;
  
  // Apply body class for theme updates based on polarity
  const isNeg = data.polarity.includes('-');
  document.body.className = isNeg ? 'polarity-neg' : 'polarity-pos';
  
  // Update header badges
  polarityBadge.textContent = data.polarity;
  const dataQualityIssues = getDataQualityIssues(data);
  if (dataQualityIssues.length > 0) {
    chromatogramIndicator.textContent = "Warnings";
    chromatogramIndicator.style.color = "#fbbf24";
    chromatogramIndicator.title = dataQualityIssues.map(issue => issue.message).join(" | ");
  } else {
    chromatogramIndicator.textContent = "Ready";
    chromatogramIndicator.style.color = "var(--color-lib-text)";
    chromatogramIndicator.title = "";
  }
  
  // Reset view
  if (btnShowSpectra && btnShow3D) {
    btnShowSpectra.classList.add('active');
    btnShow3D.classList.remove('active');
    state.spectraViewMode = 'spectra';
    document.querySelector('.spectra-grid').style.display = 'grid';
    document.querySelector('.reference-grid').style.display = 'block';
    plotly3DContainer.style.display = 'none';
  }

  clearDetails();
  renderChromatogram();
  renderPeakTable();
}

// Handle search query
function handleSearch(query) {
  state.searchQuery = query.toLowerCase().trim();
  renderPeakTable();
}

// Set active filter tab
function setFilter(filterType) {
  state.activeFilter = filterType;
  renderPeakTable();
}

// Clear detail pane and spectra plots
function clearDetails() {
  state.selectedPeak = null;
  emptyDetailsState.style.display = "flex";
  activeDetailsState.style.display = "none";
  
  // Clear charts and show placeholders
  ms1Placeholder.style.display = "flex";
  ms2Placeholder.style.display = "flex";
  eicPlaceholder.style.display = "flex";
  if (plotly3DPlaceholder) {
    plotly3DPlaceholder.style.display = "flex";
    plotly3DPlaceholder.querySelector('span').textContent = "Select a peak to view the 3D raw signal map";
  }
  chromSelectionSummary.textContent = "No peak selected. Red markers are detected BPC apexes.";
  fragmentMatchPanel.style.display = "none";
  fragmentMatchBody.innerHTML = "";
  if (detRelationsContainer) {
    detRelationsContainer.style.display = "none";
    detRelations.innerHTML = "";
  }
  
  // Purge Plotly instances if they exist
  Plotly.purge(MS1_DIV);
  Plotly.purge(MS2_DIV);
  Plotly.purge(EIC_DIV);
  Plotly.purge(PLOT_3D_DIV);
}

// Select a specific peak
function selectPeak(peak) {
  state.selectedPeak = peak;
  
  // Highlight row in table
  document.querySelectorAll('#peakTableBody tr').forEach(row => {
    if (row.dataset.peakId === peak.id) {
      row.classList.add('selected');
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      row.classList.remove('selected');
    }
  });
  
  // Update Detail Card
  showPeakDetails(peak);
  
  // Render Spectra
  renderMS1(peak);
  renderMS2(peak);
  renderFragmentMatches(peak);
  renderEIC(peak);
  render3D(peak);
  updateSelectionSummary(peak);
  
  // Update chromatogram marker without changing the user's zoom range.
  renderChromatogram();
}

function updateSelectionSummary(peak) {
  const libraryCandidate = getLibraryCandidate(peak);
  const candidate = libraryCandidate.displayName
    ? libraryCandidate.displayName
    : 'no library candidate';
  const candidateQualifier = libraryCandidate.isCodedRecord ? 'coded library record, ' : '';
  const ms2Text = peak.has_ms2
    ? `MS/MS precursor ${peak.ms2_precursor.toFixed(4)}`
    : 'no assigned MS/MS';
  chromSelectionSummary.textContent = `${peak.id}: RT ${peak.rt_corrected.toFixed(2)} min, main ion m/z ${peak.mz.toFixed(4)}, ${ms2Text}, ${candidateQualifier}${candidate}.`;
}

// Populates the detail card with selected peak's info
function showPeakDetails(peak) {
  emptyDetailsState.style.display = "none";
  activeDetailsState.style.display = "block";
  
  detPeakId.textContent = peak.id;
  detRtCorrected.textContent = `${peak.rt_corrected.toFixed(2)} min (${(peak.rt_corrected * 60).toFixed(0)} s)`;
  detMz.textContent = peak.mz.toFixed(4);
  detAbundance.textContent = Number(peak.intensity.toFixed(0)).toLocaleString('en-US');
  
  const ionization = getPeakIonization(peak);
  const neutralMass = ionization.neutralMass;
  const adductQualifier = ionization.source === 'assumed_default' ? 'assumed, not inferred' : 'inferred';
  const alternateAdducts = peak.ionization && Array.isArray(peak.ionization.adduct_candidates)
    ? peak.ionization.adduct_candidates
        .filter(candidate => candidate.adduct !== ionization.adduct)
        .slice(0, 4)
        .map(candidate => candidate.adduct)
        .join(', ')
    : '';
  const libraryPrecursorType = peak.library_match && peak.library_match.precursor_type
    ? peak.library_match.precursor_type
    : '';
  const libraryNeutralMass = neutralMassFromPrecursorType(
    peak.ms2_precursor || peak.mz,
    libraryPrecursorType
  );
  const adductParts = [
    `${ionization.adduct} (${adductQualifier}; default neutral mass approx. ${neutralMass.toFixed(4)})`
  ];
  if (libraryPrecursorType) {
    const massText = libraryNeutralMass !== null ? `; library neutral mass approx. ${libraryNeutralMass.toFixed(4)}` : '';
    adductParts.push(`library: ${libraryPrecursorType}${massText}`);
  }
  if (alternateAdducts) adductParts.push(`alternatives: ${alternateAdducts}`);
  detAdduct.textContent = adductParts.join(' | ');
  
  // Compound identification labels
  const libraryCandidate = getLibraryCandidate(peak);
  const libMatch = libraryCandidate.displayName;
  
  let typeText = "Unidentified";
  let typeClass = "match-badge unmatched";
  let nameText = "Unknown";
  let formulaText = "Formula not assigned";
  
  if (libMatch) {
    const librarySource = peak.library_match.source_file || "MS/MS library";
    typeText = libraryCandidate.isCodedRecord
      ? `MS/MS coded library record (${librarySource})`
      : `MS/MS library (${librarySource})`;
    typeClass = "match-badge lib";
    nameText = libMatch;
    formulaText = peak.library_match.formula || "Formula not available";
    
    // Show library match score and ppm
    libraryMatchStats.style.display = "block";
    detLibScore.textContent = peak.library_match.score !== null ? peak.library_match.score.toFixed(2) : '--';
    detLibError.textContent = peak.library_match.error_ppm !== null ? `${peak.library_match.error_ppm.toFixed(1)} ppm` : '--';
  } else {
    libraryMatchStats.style.display = "none";
  }

  // Analyze co-elution and adduct relations live
  const relations = checkCoelutionRelations(peak, state.sampleData.peaks, state.sampleData.polarity);
  detRelationsContainer.style.display = "block";
  if (relations.length > 0) {
    detRelations.innerHTML = '<ul style="margin: 0; padding-left: 1.2rem; display: flex; flex-direction: column; gap: 0.25rem;">' + 
      relations.map(rel => {
        let prefix = '<span>';
        if (rel.type === 'adduct') {
          prefix = '<span style="color: #4ade80; font-weight: 500;">[Adduct Relation] ';
        } else if (rel.type === 'isobaric') {
          prefix = '<span style="color: #60a5fa; font-weight: 500;">[Isobaric Overlap] ';
        } else {
          prefix = '<span style="color: #a78bfa; font-weight: 500;">[Co-elution] ';
        }
        return `<li>${prefix}${escapeHtml(rel.note)}</span></li>`;
      }).join('') + '</ul>';
  } else {
    detRelations.innerHTML = `<span style="color: var(--text-muted); font-style: italic;">No co-eluting features detected at this RT (${peak.rt_corrected.toFixed(2)} min). This peak elutes as an isolated single species.</span>`;
  }

  const warnings = getPeakWarnings(peak).map(formatWarning);
  if (libraryCandidate.note) warnings.push(libraryCandidate.note);
  if (warnings.length > 0) {
    detWarningsContainer.style.display = "block";
    detWarnings.textContent = warnings.join(" | ");
  } else {
    detWarningsContainer.style.display = "none";
    detWarnings.textContent = "--";
  }
  
  detName.textContent = nameText;
  detFormula.textContent = formulaText;
  detTypeBadge.textContent = typeText;
  detTypeBadge.className = `compound-type-badge ${typeClass}`;
  
  // MS2 availability status
  if (peak.has_ms2) {
    detMs2Status.textContent = `Yes (Precursor m/z = ${peak.ms2_precursor.toFixed(4)})`;
    detMs2Status.style.color = "var(--color-lib-text)";
    btnExportMsp.style.display = "flex";
  } else {
    detMs2Status.textContent = "Not available";
    detMs2Status.style.color = "var(--text-muted)";
    btnExportMsp.style.display = "none";
  }
  
  // Setup database external links
  const queryName = libMatch || "";
  setupExternalLinks(neutralMass, queryName, peak.mz);
}

// Generate external database search links
function setupExternalLinks(neutralMass, name, precursorMz) {
  const massQuery = neutralMass.toFixed(4);
  const nameQuery = encodeURIComponent(name);
  const query = name ? nameQuery : massQuery;
  
  linkPubChem.href = `https://pubchem.ncbi.nlm.nih.gov/#query=${query}`;
  linkGNPS.href = `https://gnps.ucsd.edu/ProteoSAFe/libraries.jsp`;
  linkHMDB.href = `https://hmdb.ca/unearth/q?query=${query}&searcher=metabolites`;
  linkMassBank.href = `https://massbank.eu/MassBank/Search?query=${precursorMz.toFixed(4)}`;
}

// Render Chromatogram using Plotly.js
function renderChromatogram() {
  if (!state.sampleData) return;
  
  const chromData = state.sampleData.chromatogram;
  const showTic = (state.chromatogramMode === 'tic');
  const traceColor = document.body.classList.contains('polarity-neg') ? '#0d9488' : '#f97316';
  
  // Choose BPC or TIC profile
  const yData = showTic ? 
    (chromData.smoothed_tic || chromData.tic) : 
    (chromData.smoothed_bpc || chromData.bpc);
    
  const traceName = showTic ? 'TIC chromatogram' : 'BPC chromatogram';
  
  // 1. Chromatogram trace line
  const mainTrace = {
    x: chromData.rt,
    y: yData,
    mode: 'lines',
    name: traceName,
    line: {
      color: traceColor,
      width: 1.3
    },
    hoverinfo: 'x+y'
  };
  
  // 2. Peak markers scatter points
  const peakX = [];
  const peakY = [];
  const peakLabels = [];
  const peakHover = [];
  
  state.sampleData.peaks.forEach(p => {
    peakX.push(p.rt_corrected); // use exact local apex
    
    // Find closest index in global chromatogram to position peak marker exactly on the line
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < chromData.rt.length; i++) {
      let diff = Math.abs(chromData.rt[i] - p.rt_corrected);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    peakY.push(yData[closestIdx]);
    
    peakLabels.push(p.id);
    
    const libraryCandidate = getLibraryCandidate(p);
    const matchName = libraryCandidate.displayName || 'Unknown';
    const qualifier = libraryCandidate.isCodedRecord ? ' (coded library record)' : '';
    peakHover.push(`${p.id}<br>RT apex: ${p.rt_corrected.toFixed(2)} min<br>m/z: ${p.mz.toFixed(4)}<br>Candidate: ${matchName}${qualifier}`);
  });
  
  const peaksTrace = {
    x: peakX,
    y: peakY,
    mode: 'markers',
    name: 'Detected peaks',
    marker: {
      color: 'rgba(239, 68, 68, 0.7)',
      size: 6,
      symbol: 'circle',
      line: { width: 1, color: '#ef4444' }
    },
    hovertext: peakHover,
    hoverinfo: 'text'
  };
  
  const traces = [mainTrace, peaksTrace];

  if (state.selectedPeak) {
    const selected = state.selectedPeak;
    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < chromData.rt.length; i++) {
      let diff = Math.abs(chromData.rt[i] - selected.rt_corrected);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    traces.push({
      x: [selected.rt_corrected],
      y: [yData[closestIdx]],
      mode: 'markers',
      name: 'Selected peak',
      marker: {
        color: '#facc15',
        size: 12,
        symbol: 'diamond',
        line: { width: 2, color: '#111827' }
      },
      hovertext: `${selected.id}<br>RT: ${selected.rt_corrected.toFixed(2)} min<br>m/z: ${selected.mz.toFixed(4)}`,
      hoverinfo: 'text'
    });
  }
  
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 60, r: 20, t: 15, b: 40 },
    showlegend: true,
    uirevision: `${state.sampleData.sample_name}-${state.chromatogramMode}`,
    legend: {
      x: 0.5,
      y: 1.12,
      xanchor: 'center',
      yanchor: 'bottom',
      orientation: 'h',
      font: { color: '#94a3b8', size: 9 },
      bgcolor: 'rgba(11, 15, 25, 0.5)'
    },
    hovermode: 'closest',
    xaxis: {
      title: { text: 'Retention time (min)', font: { size: 10, color: '#94a3b8' } },
      gridcolor: 'rgba(255,255,255,0.03)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: false
    },
    yaxis: {
      title: { text: showTic ? 'TIC intensity' : 'BPC intensity', font: { size: 10, color: '#94a3b8' } },
      gridcolor: 'rgba(255,255,255,0.03)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: false,
      exponentformat: 'e'
    },
    shapes: state.selectedPeak ? [{
      type: 'line',
      x0: state.selectedPeak.rt_corrected,
      x1: state.selectedPeak.rt_corrected,
      y0: 0,
      y1: 1,
      xref: 'x',
      yref: 'paper',
      line: { color: '#facc15', width: 1.3, dash: 'dot' }
    }] : []
  };
  
  const config = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toggleSpikelines']
  };
  
  Plotly.react(CHROMATOGRAM_DIV, traces, layout, config);
  
  // Set up click handler on chromatogram peaks
  const graphDiv = document.getElementById(CHROMATOGRAM_DIV);
  graphDiv.on('plotly_click', (data) => {
    if (data.points && data.points.length > 0) {
      const point = data.points[0];
      // Check if clicked point belongs to the peaks trace (trace index 1)
      if (point.curveNumber === 1) {
        const peakIdx = point.pointNumber;
        const clickedPeak = state.sampleData.peaks[peakIdx];
        if (clickedPeak) {
          selectPeak(clickedPeak);
        }
      }
    }
  });
}

function resetChromatogramZoom() {
  if (!state.sampleData) return;
  Plotly.relayout(CHROMATOGRAM_DIV, {
    'xaxis.autorange': true,
    'yaxis.autorange': true
  });
}

function renderEIC(peak) {
  eicPlaceholder.style.display = "none";

  if (!peak.eic || !Array.isArray(peak.eic.rt) || !Array.isArray(peak.eic.intensity) || peak.eic.rt.length === 0) {
    Plotly.purge(EIC_DIV);
    eicPlaceholder.querySelector('span').textContent = "No local EIC is available for this peak.";
    eicPlaceholder.style.display = "flex";
    return;
  }

  const eicColor = document.body.classList.contains('polarity-neg') ? '#2dd4bf' : '#fb923c';
  const trace = {
    x: peak.eic.rt,
    y: peak.eic.intensity,
    mode: 'lines+markers',
    name: `EIC m/z ${peak.mz.toFixed(4)}`,
    line: { color: eicColor, width: 2 },
    marker: { color: eicColor, size: 4 },
    hovertemplate: 'RT: %{x:.3f} min<br>EIC intensity: %{y:.3e}<extra></extra>'
  };

  const apexTrace = {
    x: [peak.rt_corrected],
    y: [Math.max(...peak.eic.intensity)],
    mode: 'markers',
    name: 'Apex BPC',
    marker: {
      color: '#facc15',
      size: 10,
      symbol: 'diamond',
      line: { width: 1, color: '#111827' }
    },
    hovertemplate: `${peak.id}<br>RT apex: ${peak.rt_corrected.toFixed(3)} min<extra></extra>`
  };

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 60, r: 20, t: 10, b: 35 },
    showlegend: true,
    legend: {
      x: 0.5,
      y: 1.16,
      xanchor: 'center',
      yanchor: 'bottom',
      orientation: 'h',
      font: { color: '#94a3b8', size: 9 },
      bgcolor: 'rgba(11, 15, 25, 0.5)'
    },
    xaxis: {
      title: { text: 'RT local (min)', font: { size: 10, color: '#94a3b8' } },
      gridcolor: 'rgba(255,255,255,0.03)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: false
    },
    yaxis: {
      title: { text: 'EIC intensity', font: { size: 10, color: '#94a3b8' } },
      gridcolor: 'rgba(255,255,255,0.03)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: false,
      exponentformat: 'e'
    },
    shapes: [{
      type: 'line',
      x0: peak.rt_corrected,
      x1: peak.rt_corrected,
      y0: 0,
      y1: 1,
      xref: 'x',
      yref: 'paper',
      line: { color: '#facc15', width: 1.2, dash: 'dot' }
    }]
  };

  const config = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toggleSpikelines']
  };

  Plotly.react(EIC_DIV, [trace, apexTrace], layout, config);
}

// Populates and filters the peak list table
function renderPeakTable() {
  peakTableBody.innerHTML = '';
  
  const peaks = state.sampleData.peaks;
  
  // Filter peaks based on criteria
  const filteredPeaks = peaks.filter(p => {
    const matchSearch = 
      p.id.toLowerCase().includes(state.searchQuery) ||
      p.mz.toFixed(4).includes(state.searchQuery) ||
      p.rt.toFixed(2).includes(state.searchQuery) ||
      p.rt_corrected.toFixed(2).includes(state.searchQuery) ||
      getLibraryCandidate(p).searchText.includes(state.searchQuery);
      
    if (!matchSearch) return false;
    
    switch (state.activeFilter) {
      case 'lib':
        return p.library_match.name !== '';
      case 'ms2':
        return p.has_ms2;
      case 'all':
      default:
        return true;
    }
  });
  
  peakCountIndicator.textContent = `(${filteredPeaks.length})`;
  
  if (filteredPeaks.length === 0) {
    const emptyRow = document.createElement('tr');
    emptyRow.innerHTML = `<td colspan="4" style="text-align: center; color: var(--text-muted); padding: 2rem;">No peaks match the current filters</td>`;
    peakTableBody.appendChild(emptyRow);
    return;
  }
  
  filteredPeaks.forEach(p => {
    const row = document.createElement('tr');
    row.dataset.peakId = p.id;
    
    if (state.selectedPeak && state.selectedPeak.id === p.id) {
      row.className = 'selected';
    }
    
    // Determine cell match badges
    const libraryCandidate = getLibraryCandidate(p);
    let matchLabel = '<span class="match-badge unmatched">No library candidate</span>';
    if (libraryCandidate.displayName) {
      const qualifier = libraryCandidate.isCodedRecord ? ' <span style="opacity: 0.72;">(coded record)</span>' : '';
      const title = libraryCandidate.isCodedRecord ? ` title="${escapeHtml(libraryCandidate.rawName)}"` : '';
      matchLabel = `<span class="match-badge lib"${title}><span class="match-dot lib"></span>${escapeHtml(libraryCandidate.displayName)}${qualifier}</span>`;
    }
    
    row.innerHTML = `
      <td><strong>${p.id}</strong></td>
      <td style="text-align: right; color: var(--text-secondary);">${p.rt_corrected.toFixed(2)}</td>
      <td style="text-align: right; font-weight: 500;">${p.mz.toFixed(4)}</td>
      <td>${matchLabel}</td>
    `;
    
    row.addEventListener('click', () => selectPeak(p));
    peakTableBody.appendChild(row);
  });
}

// Render MS1 Stick Spectrum
function renderMS1(peak) {
  ms1Placeholder.style.display = "none";
  
  const specData = peak.ms1_spectrum;
  if (!specData || specData.length === 0) {
    Plotly.purge(MS1_DIV);
    ms1Placeholder.querySelector('span').textContent = "MS1 spectrum is empty or not indexed";
    ms1Placeholder.style.display = "flex";
    return;
  }
  
  const mzs = specData.map(d => d.mz);
  const relInts = specData.map(d => d.rel_int);
  
  // Format vertical sticks
  const trace = {
    x: mzs,
    y: relInts,
    type: 'bar',
    width: 0.15,
    marker: {
      color: '#8b5cf6'
    },
    hovertemplate: 'm/z: %{x:.4f}<br>Intensity: %{y:.1f}%<extra></extra>'
  };
  
  // Add annotations for top 5 peaks
  const annotations = [];
  const topIndices = relInts
    .map((val, idx) => ({ val, idx }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 5);
    
  topIndices.forEach(item => {
    if (item.val > 1.0) { // Only label peaks above 1% abundance
      annotations.push({
        x: mzs[item.idx],
        y: relInts[item.idx],
        text: mzs[item.idx].toFixed(4),
        xanchor: 'center',
        yanchor: 'bottom',
        showarrow: false,
        font: {
          family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
          size: 9,
          color: '#ef4444',
          weight: 'bold'
        },
        yshift: 2
      });
    }
  });
  
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 40, r: 15, t: 25, b: 35 },
    xaxis: {
      title: { text: 'm/z', font: { size: 10, color: '#64748b' } },
      gridcolor: 'rgba(255,255,255,0.02)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: false
    },
    yaxis: {
      title: { text: 'Relative abundance (%)', font: { size: 10, color: '#64748b' } },
      gridcolor: 'rgba(255,255,255,0.02)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: false,
      range: [0, 115]
    },
    annotations: annotations,
    showlegend: false
  };
  
  const config = { responsive: true, displayModeBar: false };
  Plotly.newPlot(MS1_DIV, [trace], layout, config);
}

// Render experimental MS2 fragment stick spectrum (with Mirror Plot overlay if library is available).
function renderMS2(peak) {
  ms2Placeholder.style.display = "none";
  
  if (!peak.has_ms2) {
    Plotly.purge(MS2_DIV);
    ms2Placeholder.querySelector('span').textContent = "This peak has no tandem fragmentation data (MS2)";
    ms2Placeholder.style.display = "flex";
    return;
  }
  
  const specData = peak.ms2_spectrum;
  if (!specData || specData.length === 0) {
    Plotly.purge(MS2_DIV);
    ms2Placeholder.querySelector('span').textContent = "MS2 spectrum is empty or not indexed";
    ms2Placeholder.style.display = "flex";
    return;
  }
  
  const mzs = specData.map(d => d.mz);
  const relInts = specData.map(d => d.rel_int);
  const expColor = document.body.classList.contains('polarity-neg') ? '#0d9488' : '#ec4899';
  
  const libraryCandidate = getLibraryCandidate(peak);
  const hasLibrary = !!(libraryCandidate && libraryCandidate.displayName && peak.library_match && peak.library_match.reference_spectrum && peak.library_match.reference_spectrum.length > 0);
  
  let traces = [];
  let annotations = [];
  let yRange = [0, 115];
  let yAxisConfig = {
    title: { text: 'Relative abundance (%)', font: { size: 10, color: '#64748b' } },
    gridcolor: 'rgba(255,255,255,0.02)',
    tickfont: { color: '#64748b', size: 9 },
    zeroline: false,
    range: yRange
  };

  if (hasLibrary) {
    // Combined Mirror Plot
    const refData = peak.library_match.reference_spectrum;
    const refMzs = refData.map(d => d.mz);
    const refRelInts = refData.map(d => d.rel_int);
    
    // Compute matches
    const matches = computeMatchedFragments(peak);
    const matchedExpMzs = new Set(matches.map(m => m.expMz));
    const matchedRefMzs = new Set(matches.map(m => m.refMz));
    
    // Color arrays: highlight matched signals in green
    const expColors = mzs.map(mz => matchedExpMzs.has(mz) ? '#22c55e' : expColor);
    const libColors = refMzs.map(mz => matchedRefMzs.has(mz) ? '#16a34a' : 'rgba(148, 163, 184, 0.4)');
    
    // Trace 1: Experimental spectrum (pointing upwards)
    traces.push({
      x: mzs,
      y: relInts,
      type: 'bar',
      width: 0.15,
      name: 'Experimental MS2',
      marker: { color: expColors },
      hovertemplate: 'm/z: %{x:.4f}<br>Abundance: %{y:.1f}%<extra></extra>'
    });
    
    // Trace 2: Library Reference spectrum (pointing downwards)
    const refRelIntsNeg = refRelInts.map(val => -val);
    traces.push({
      x: refMzs,
      y: refRelIntsNeg,
      customdata: refRelInts,
      type: 'bar',
      width: 0.15,
      name: 'Library Reference',
      marker: { color: libColors },
      hovertemplate: 'm/z: %{x:.4f}<br>Library: %{customdata:.1f}%<extra></extra>'
    });
    
    // Annotate top 5 experimental peaks (upward)
    const topExpIndices = relInts
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 5);
      
    topExpIndices.forEach(item => {
      if (item.val > 1.0) {
        annotations.push({
          x: mzs[item.idx],
          y: relInts[item.idx],
          text: mzs[item.idx].toFixed(4),
          xanchor: 'center',
          yanchor: 'bottom',
          showarrow: false,
          font: {
            family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            size: 9,
            color: '#ef4444',
            weight: 'bold'
          },
          yshift: 2
        });
      }
    });
    
    // Annotate top 5 library peaks (downward)
    const topLibIndices = refRelInts
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 5);
      
    topLibIndices.forEach(item => {
      if (item.val > 1.0) {
        annotations.push({
          x: refMzs[item.idx],
          y: -refRelInts[item.idx],
          text: refMzs[item.idx].toFixed(4),
          xanchor: 'center',
          yanchor: 'top',
          showarrow: false,
          font: {
            family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            size: 9,
            color: 'rgba(255,255,255,0.7)',
            weight: 'bold'
          },
          yshift: -2
        });
      }
    });
    
    yRange = [-115, 115];
    yAxisConfig = {
      title: { text: 'Relative abundance (%)', font: { size: 10, color: '#64748b' } },
      gridcolor: 'rgba(255,255,255,0.02)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: true,
      zerolinecolor: 'rgba(255,255,255,0.2)',
      zerolinewidth: 1,
      range: yRange,
      tickvals: [-100, -50, 0, 50, 100],
      ticktext: ['100% (Lib)', '50% (Lib)', '0%', '50% (Exp)', '100% (Exp)']
    };
  } else {
    // Normal single plot pointing up (no library available)
    traces.push({
      x: mzs,
      y: relInts,
      type: 'bar',
      width: 0.15,
      name: 'Experimental MS2',
      marker: { color: expColor },
      hovertemplate: 'm/z: %{x:.4f}<br>Abundance: %{y:.1f}%<extra></extra>'
    });
    
    const topExpIndices = relInts
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .slice(0, 5);
      
    topExpIndices.forEach(item => {
      if (item.val > 1.0) {
        annotations.push({
          x: mzs[item.idx],
          y: relInts[item.idx],
          text: mzs[item.idx].toFixed(4),
          xanchor: 'center',
          yanchor: 'bottom',
          showarrow: false,
          font: {
            family: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
            size: 9,
            color: '#ef4444',
            weight: 'bold'
          },
          yshift: 2
        });
      }
    });
  }
  
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 55, r: 15, t: 25, b: 35 },
    showlegend: false,
    xaxis: {
      title: { text: 'm/z', font: { size: 10, color: '#64748b' } },
      gridcolor: 'rgba(255,255,255,0.02)',
      tickfont: { color: '#64748b', size: 9 },
      zeroline: false
    },
    yaxis: yAxisConfig,
    annotations: annotations
  };
  
  const config = { responsive: true, displayModeBar: false };
  Plotly.newPlot(MS2_DIV, traces, layout, config);
}

function getReferenceSpectrum(peak) {
  if (!peak.library_match || !Array.isArray(peak.library_match.reference_spectrum)) {
    return [];
  }
  return peak.library_match.reference_spectrum;
}

function computeMatchedFragments(peak, toleranceDa = FRAGMENT_MATCH_TOLERANCE_DA) {
  const exp = Array.isArray(peak.ms2_spectrum) ? peak.ms2_spectrum : [];
  const ref = getReferenceSpectrum(peak);
  const matches = [];
  const usedRef = new Set();

  exp.forEach(expPeak => {
    let bestIdx = -1;
    let bestDiff = toleranceDa;
    ref.forEach((refPeak, refIdx) => {
      if (usedRef.has(refIdx)) return;
      const diff = Math.abs(Number(expPeak.mz) - Number(refPeak.mz));
      if (diff <= bestDiff) {
        bestDiff = diff;
        bestIdx = refIdx;
      }
    });

    if (bestIdx >= 0) {
      usedRef.add(bestIdx);
      const refPeak = ref[bestIdx];
      matches.push({
        expMz: Number(expPeak.mz),
        refMz: Number(refPeak.mz),
        deltaDa: Number(expPeak.mz) - Number(refPeak.mz),
        expRel: Number(expPeak.rel_int),
        refRel: Number(refPeak.rel_int)
      });
    }
  });

  matches.sort((a, b) => b.expRel - a.expRel);
  return matches;
}

// Library reference rendering is obsolete. Library reference is now drawn inside the MS2 Mirror Plot trace.
function renderLibraryReference(peak) {
}

function renderFragmentMatches(peak) {
  const matches = computeMatchedFragments(peak);
  fragmentMatchBody.innerHTML = "";

  if (!matches.length) {
    fragmentMatchPanel.style.display = "none";
    return;
  }

  fragmentMatchPanel.style.display = "flex";
  matches.forEach(match => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${match.expMz.toFixed(4)}</td>
      <td>${match.refMz.toFixed(4)}</td>
      <td>${match.deltaDa >= 0 ? '+' : ''}${match.deltaDa.toFixed(4)}</td>
      <td>${match.expRel.toFixed(1)}</td>
      <td>${match.refRel.toFixed(1)}</td>
    `;
    fragmentMatchBody.appendChild(row);
  });
}

// Exports the selected peak's MS2 spectrum as a download link in MSP format
function exportSelectedPeakMSP() {
  const peak = state.selectedPeak;
  if (!peak || !peak.has_ms2 || !peak.ms2_spectrum || peak.ms2_spectrum.length === 0) {
    alert("No MS2 spectrum is available for export.");
    return;
  }
  
  const sampleName = state.sampleData.sample_name;
  const libraryCandidate = getLibraryCandidate(peak);
  const matchName = libraryCandidate.displayName || `Unknown_${peak.id}`;
  const formula = peak.library_match.formula || "";
  const ionization = getPeakIonization(peak);
  const ionMode = state.sampleData.polarity.includes('-') ? 'Negative' : 'Positive';
  
  let mspContent = `Name: ${matchName}\n`;
  if (formula) mspContent += `Formula: ${formula}\n`;
  mspContent += `PrecursorMZ: ${peak.ms2_precursor.toFixed(4)}\n`;
  if (ionization.adduct) mspContent += `Precursor_type: ${ionization.adduct}\n`;
  mspContent += `Ion_mode: ${ionMode}\n`;
  mspContent += `ExactMass: ${ionization.neutralMass.toFixed(6)}\n`;
  mspContent += `Collision_energy: ramp 20-50 eV\n`;
  const rawLibraryRecord = libraryCandidate.rawName && libraryCandidate.rawName !== libraryCandidate.displayName
    ? ` Raw_library_record="${libraryCandidate.rawName.replace(/"/g, "'")}"`
    : '';
  mspContent += `Comment: Peak_ID=${peak.id} RT_min=${peak.rt_corrected.toFixed(4)} Sample=${sampleName} Polarity=${state.sampleData.polarity} CE_note=MSMS_ramped_20-50eV_no_individual_scan_CE${rawLibraryRecord}\n`;
  mspContent += `Num Peaks: ${peak.ms2_spectrum.length}\n`;
  
  peak.ms2_spectrum.forEach(p => {
    mspContent += `${p.mz.toFixed(4)} ${p.int.toFixed(0)}\n`;
  });
  
  const blob = new Blob([mspContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sampleName.replace(/\s+/g, '_')}_${peak.id}_MS2.msp`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Render MS1 raw 3D Scatter Map (RT vs m/z vs Intensity)
function render3D(peak) {
  if (!plotly3DPlaceholder) return;
  
  plotly3DPlaceholder.style.display = "none";
  
  if (state.spectraViewMode !== '3d') {
    return; // Prevent plotting when hidden to avoid container resizing bugs
  }
  
  if (!peak) {
    Plotly.purge(PLOT_3D_DIV);
    plotly3DPlaceholder.querySelector('span').textContent = "Select a peak to view the 3D raw signal map";
    plotly3DPlaceholder.style.display = "flex";
    return;
  }
  
  const rawPoints = peak.points_3d;
  if (!rawPoints || rawPoints.length === 0) {
    Plotly.purge(PLOT_3D_DIV);
    plotly3DPlaceholder.querySelector('span').textContent = "No MS1 raw signal points available in the 3D range";
    plotly3DPlaceholder.style.display = "flex";
    return;
  }
  
  // Extract data arrays
  const xData = rawPoints.map(p => p.rt);
  const yData = rawPoints.map(p => p.mz);
  const zData = rawPoints.map(p => p.intensity);
  
  // Scale marker sizes dynamically
  const maxInt = Math.max(...zData);
  const markerSizes = zData.map(z => {
    return 3 + 12 * (z / (maxInt || 1));
  });
  
  // Neon colorscale: Cyan -> Pink -> Gold
  const trace = {
    x: xData,
    y: yData,
    z: zData,
    mode: 'markers',
    type: 'scatter3d',
    marker: {
      size: markerSizes,
      color: zData,
      colorscale: [
        [0.0, '#00ffff'],   // Cyan (bright) for low intensity
        [0.5, '#ec4899'],   // Pink/Magenta for medium intensity
        [1.0, '#eab308']    // Gold/Yellow for high intensity (apex)
      ],
      colorbar: {
        title: { text: 'Intensity', font: { color: '#94a3b8', size: 10 } },
        tickfont: { color: '#94a3b8', size: 9 },
        exponentformat: 'e'
      },
      opacity: 0.85,
      line: { width: 0 }
    },
    hovertemplate: 'RT: %{x:.3f} min<br>m/z: %{y:.4f}<br>Int: %{z:.3e}<extra></extra>'
  };
  
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { l: 0, r: 0, t: 30, b: 0 },
    scene: {
      xaxis: {
        title: { text: 'RT (min)', font: { color: '#94a3b8', size: 11 } },
        gridcolor: 'rgba(255,255,255,0.06)',
        tickfont: { color: '#64748b', size: 9 },
        backgroundcolor: '#0b0f19',
        showbackground: true
      },
      yaxis: {
        title: { text: 'm/z', font: { color: '#94a3b8', size: 11 } },
        gridcolor: 'rgba(255,255,255,0.06)',
        tickfont: { color: '#64748b', size: 9 },
        backgroundcolor: '#0b0f19',
        showbackground: true
      },
      zaxis: {
        title: { text: 'Intensity', font: { color: '#94a3b8', size: 11 } },
        gridcolor: 'rgba(255,255,255,0.06)',
        tickfont: { color: '#64748b', size: 9 },
        backgroundcolor: '#0b0f19',
        showbackground: true,
        exponentformat: 'e'
      },
      camera: {
        eye: { x: 1.6, y: 1.6, z: 1.3 }
      }
    }
  };
  
  const config = {
    responsive: true,
    displayModeBar: true,
    modeBarButtonsToRemove: ['sendDataToCloud']
  };
  
  Plotly.react(PLOT_3D_DIV, [trace], layout, config);
}

// Analyze co-elution and adduct relations between peaks of the active sample
function checkCoelutionRelations(peak, allPeaks, polarity) {
  const relations = [];
  const rtTol = 0.15; // 9 seconds tolerance
  const isNeg = polarity.includes('-');
  
  allPeaks.forEach(other => {
    if (other.id === peak.id) return;
    
    const rtDiff = Math.abs(other.rt_corrected - peak.rt_corrected);
    if (rtDiff > rtTol) return;
    
    // Co-eluting! Let's check mass differences
    const mzDiff = Math.abs(other.mz - peak.mz);
    
    if (isNeg) {
      // ESI(-) differences
      if (Math.abs(mzDiff - 46.0055) <= 0.02) {
        relations.push({
          type: 'adduct',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ~46.01 Da matches [M+HCOO]- vs [M-H]- adduct relation)`
        });
      } else if (Math.abs(mzDiff - 35.9762) <= 0.02) {
        relations.push({
          type: 'adduct',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ~35.98 Da matches [M+Cl]- vs [M-H]- adduct relation)`
        });
      } else if (Math.abs(mzDiff - 0.0364) <= 0.005) {
        relations.push({
          type: 'isobaric',
          target: other.id,
          note: `Isobaric overlap with ${other.id} (mass delta ~0.036 Da matches CH4 vs O formula exchange)`
        });
      } else {
        relations.push({
          type: 'coelution',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ${mzDiff.toFixed(4)} Da, likely separate compound)`
        });
      }
    } else {
      // ESI(+) differences
      if (Math.abs(mzDiff - 21.9819) <= 0.02) {
        relations.push({
          type: 'adduct',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ~21.98 Da matches [M+Na]+ vs [M+H]+ adduct relation)`
        });
      } else if (Math.abs(mzDiff - 37.9559) <= 0.02) {
        relations.push({
          type: 'adduct',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ~37.96 Da matches [M+K]+ vs [M+H]+ adduct relation)`
        });
      } else if (Math.abs(mzDiff - 17.0265) <= 0.02) {
        relations.push({
          type: 'adduct',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ~17.03 Da matches [M+NH4]+ vs [M+H]+ adduct relation)`
        });
      } else if (Math.abs(mzDiff - 42.0338) <= 0.02) {
        relations.push({
          type: 'adduct',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ~42.03 Da matches [M+ACN+H]+ vs [M+H]+ adduct relation)`
        });
      } else if (Math.abs(mzDiff - 15.9740) <= 0.02) {
        relations.push({
          type: 'adduct',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ~15.97 Da matches [M+K]+ vs [M+Na]+ adduct relation)`
        });
      } else if (Math.abs(mzDiff - 0.0364) <= 0.005) {
        relations.push({
          type: 'isobaric',
          target: other.id,
          note: `Isobaric overlap with ${other.id} (mass delta ~0.036 Da matches CH4 vs O formula exchange)`
        });
      } else {
        relations.push({
          type: 'coelution',
          target: other.id,
          note: `Co-elutes with ${other.id} (mass delta ${mzDiff.toFixed(4)} Da, likely separate compound)`
        });
      }
    }
  });
  
  return relations;
}
