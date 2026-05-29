import { useState, useCallback, useEffect } from "react";

// ─── Protocol Stages ─────────────────────────────────────────────────────────
const STAGES = [
  { id:"baseline", label:"Baseline",       dose:null, shortLabel:"Base" },
  { id:"s2_5",    label:"2.5 µg/kg/min",  dose:2.5,  shortLabel:"2.5"  },
  { id:"s5",      label:"5 µg/kg/min",     dose:5,    shortLabel:"5"    },
  { id:"s7_5",    label:"7.5 µg/kg/min",  dose:7.5,  shortLabel:"7.5"  },
  { id:"s10",     label:"10 µg/kg/min",    dose:10,   shortLabel:"10"   },
  { id:"s12_5",   label:"12.5 µg/kg/min", dose:12.5, shortLabel:"12.5" },
  { id:"s15",     label:"15 µg/kg/min",    dose:15,   shortLabel:"15"   },
  { id:"s17_5",   label:"17.5 µg/kg/min", dose:17.5, shortLabel:"17.5" },
  { id:"s20",     label:"20 µg/kg/min ✓", dose:20,   shortLabel:"20"   },
];

const STOP_CRITERIA = [
  { id:"max_dose",   label:"Max dose (20 µg/kg/min)" },
  { id:"hr_100",     label:"HR ≥ 100 bpm" },
  { id:"hr_rise",    label:"HR rise > 20 bpm" },
  { id:"pos_ava",    label:"Positive: AVA > 1.0 cm²" },
  { id:"pos_severe", label:"Positive: Vmax > 4 m/s or ΔP̄ > 40 mmHg" },
  { id:"no_cr",      label:"No contractile reserve" },
  { id:"symptoms",   label:"Patient symptoms" },
  { id:"bp_drop",    label:"BP drop" },
  { id:"arrhythmia", label:"Arrhythmia" },
  { id:"svi_increase", label:"SVI increase ≥ 20%" },
  { id:"wall_motion",  label:"New wall motion abnormalities" },
];

const emptyStage = () => ({
  lvotVTI:"", avVTI:"", avPeakVelocity:"",
  meanGradient:"", lvEjectionTime:"", heartRate:"",
  stopped:false, stopReason:"",
});

const initialStageData = () =>
  Object.fromEntries(STAGES.map(s => [s.id, emptyStage()]));

// ─── Calculations ─────────────────────────────────────────────────────────────
const p = v => parseFloat(v);
const valid = (...vals) =>
  vals.every(v => v!==""&&v!==null&&v!==undefined&&!isNaN(p(v))&&p(v)>0);

const calcBSA  = (h,w)   => valid(h,w)   ? Math.sqrt((p(h)*p(w))/3600) : null;
const calcSV   = (d,vti) => valid(d,vti) ? Math.PI*Math.pow(p(d)/2,2)*p(vti) : null;
const calcAVA  = (sv,vti)=> sv&&valid(vti) ? sv/p(vti) : null;
const calcFlow = (sv,t)  => sv&&valid(t) ? (sv/p(t))*1000 : null;
const calcSVI  = (sv,bsa)=> sv&&valid(bsa) ? sv/p(bsa) : null;

// Projected AVA (AVAProj): linear extrapolation of AVA/flow relationship to 250 mL/s
// AVAProj = AVArest + (AVApeak − AVArest) × (250 − FRrest) / (FRpeak − FRrest)
// Only valid when FRpeak > FRrest and flow augmentation ≥ 15%
function calcAVAProj(avaRest, avaPeak, frRest, frPeak) {
  if (!avaRest||!avaPeak||!frRest||!frPeak) return null;
  if (frPeak <= frRest) return null;
  const flowAug = ((frPeak - frRest) / frRest) * 100;
  if (flowAug < 15) return null; // prerequisite not met
  return avaRest + (avaPeak - avaRest) * (250 - frRest) / (frPeak - frRest);
}

function classifyAVA(a){
  if(a===null) return null;
  if(a<1.0) return "severe";
  if(a<1.5) return "moderate";
  return "mild";
}
function contractileReserve(base,peak){
  if(!base||!peak) return null;
  return ((peak-base)/base)*100 >= 20;
}
function detectPositive(ava,vel,grad){
  if(ava!==null&&ava>1.0) return "AVA > 1.0 cm²";
  const hv=valid(vel)&&p(vel)>4.0;
  const hg=valid(grad)&&p(grad)>40;
  if((hv||hg)&&ava!==null&&ava<1.0){
    if(hv&&hg) return `Vmax ${vel} m/s & ΔP̄ ${grad} mmHg (AVA<1.0)`;
    if(hv)     return `Vmax ${vel} m/s > 4 m/s (AVA<1.0)`;
    return `ΔP̄ ${grad} mmHg > 40 mmHg (AVA<1.0)`;
  }
  return false;
}
function fmt(val,dec=1){
  if(val===null||val===undefined||isNaN(val)) return "—";
  return val.toFixed(dec);
}
function fmtDate(){
  return new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
}

const C={severe:"#FF3B30",moderate:"#FF9500",mild:"#34C759",low:"#FF3B30",normal:"#34C759"};

// ─── PDF / Print Export ────────────────────────────────────────────────────
// Opens the report as a full HTML page in a new tab. The page stays open
// so the user can read it, use the browser Print dialog (Save as PDF, AirPrint, etc.)
// Works on mobile (iOS Share → Print / Save to Files) and desktop.
function openReportInTab(html){
  // Inject a "Print / Save as PDF" button and auto-open print dialog hint
  const fullHtml = html.replace("</body>","" +
    `<div style="position:fixed;bottom:0;left:0;right:0;background:#1C1C1E;padding:12px 16px;display:flex;gap:10px;align-items:center;z-index:9999;">` +
    `<button onclick="window.print()" style="flex:1;padding:12px;background:#007AFF;color:white;border:none;border-radius:10px;font-size:15px;font-weight:600;font-family:-apple-system,sans-serif;cursor:pointer;">` +
    `🖨 Print / Save as PDF</button>` +
    `<button onclick="document.querySelector('.print-bar').style.display='none'" style="padding:12px 16px;background:#3A3A3C;color:white;border:none;border-radius:10px;font-size:15px;font-family:-apple-system,sans-serif;cursor:pointer;">` +
    `✕</button></div>` +
    `<div style="height:70px;"></div>` +
    `</body>`
  );
  const blob = new Blob([fullHtml], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  // Try opening in new tab first (works on desktop and most Android)
  const tab = window.open(url, "_blank");
  if (!tab) {
    // Blocked by popup blocker — fall back to download
    a.href = url;
    a.download = "LDDSE_Report.html";
    a.click();
  }
  // Revoke after a delay so the page can load
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function buildReportHTML({patientName,patientDOB,reportingDoc,lvotDiameter,bsa,height,weight,hwUnits,stageData,results,crPresent,baseSV,peakSV,interp,avaProj,avaProjIndexed,avaProjClass,avaProjIndicated,flowAugPct,baseFlow,peakFlowForProj}){
  const filled=STAGES.filter(s=>
    ["lvotVTI","avVTI","avPeakVelocity","meanGradient","lvEjectionTime","heartRate"].some(f=>stageData[s.id][f]!=="")
  );
  const stageRows=filled.map(s=>{
    const d=stageData[s.id],r=results[s.id];
    const pos=detectPositive(r.ava,d.avPeakVelocity,d.meanGradient);
    let note="";
    if(pos) note+=`<span style="color:#34C759;font-weight:700;">★ Positive</span><br/><span style="font-size:8px;color:#34C759;">${pos}</span>`;
    if(d.stopped) note+=`${note?"<br/>":""}<span style="color:#FF3B30;font-weight:700;">⛔ Stopped</span><br/><span style="font-size:8px;color:#FF3B30;">${d.stopReason}</span>`;
    return `<tr>
      <td class="rl">${s.label.replace(" ✓","")}</td>
      <td>${d.heartRate||"—"}</td><td>${d.lvotVTI||"—"}</td><td>${d.avVTI||"—"}</td>
      <td>${d.avPeakVelocity||"—"}</td><td>${d.meanGradient||"—"}</td><td>${d.lvEjectionTime||"—"}</td>
      <td class="calc">${fmt(r.sv,1)}</td>
      <td class="calc" style="color:${r.svi&&r.svi<35?"#FF3B30":"inherit"}">${fmt(r.svi,1)}</td>
      <td class="calc" style="color:${r.ava?r.ava<1?"#FF3B30":r.ava>1?"#34C759":"#FF9500":"inherit"};font-weight:700;">${fmt(r.ava,2)}</td>
      <td class="calc" style="color:${r.flowRate&&r.flowRate<200?"#FF3B30":"inherit"}">${fmt(r.flowRate,0)}</td>
      <td style="font-size:9px;line-height:1.45;">${note||"—"}</td>
    </tr>`;
  }).join("");

  const svAug=baseSV&&peakSV?fmt(((peakSV-baseSV)/baseSV)*100,0)+"%":"—";
  const peakAVAVal=Math.max(...STAGES.map(s=>results[s.id].ava||0));

  const interpHTML=interp?`
    <div style="background:${interp.color}12;border:1px solid ${interp.color}30;border-radius:8px;padding:12px 14px;">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:${interp.color};margin-bottom:4px;">Clinical Interpretation</div>
      <div style="font-size:13px;font-weight:700;color:${interp.color};margin-bottom:6px;">${interp.label}</div>
      <div style="font-size:10px;line-height:1.6;color:#3A3A3C;margin-bottom:8px;">${interp.text}</div>
      ${interp.criteria.map(c=>`<div style="display:flex;gap:7px;padding:3px 0;border-bottom:1px solid #E5E5EA;font-size:10px;color:#6E6E73;">
        <span style="color:${c.met===true?"#34C759":c.met===false?"#FF3B30":"#8E8E93"};font-weight:700;flex-shrink:0;">${c.met===true?"✓":c.met===false?"✗":"–"}</span>
        <span>${c.text}</span></div>`).join("")}
    </div>`:`<div style="background:#F9F9FB;border:1px solid #E5E5EA;border-radius:8px;padding:12px 14px;">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:#6E6E73;margin-bottom:5px;">Clinical Interpretation</div>
      <div style="color:#AEAEB2;font-size:10px;">Insufficient data for automated interpretation</div></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>LDDSE${patientName?" – "+patientName:""}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;font-size:10.5px;color:#1C1C1E;padding:16px 20px;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1C1C1E;padding-bottom:10px;margin-bottom:12px;}
.hdr h1{font-size:16px;font-weight:700;letter-spacing:-0.3px;}
.hdr .sub{font-size:9.5px;color:#6E6E73;margin-top:2px;}
.hdr-r{text-align:right;font-size:9.5px;color:#6E6E73;line-height:1.9;}
.meta{display:flex;gap:7px;margin-bottom:12px;flex-wrap:wrap;}
.mc{background:#F2F2F7;border-radius:6px;padding:6px 10px;flex:1;min-width:90px;}
.mc label{font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6E6E73;display:block;margin-bottom:2px;}
.mc span{font-size:12px;font-weight:700;}
h2{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6E6E73;margin:12px 0 5px;}
table{width:100%;border-collapse:collapse;font-size:10px;}
thead tr{background:#F2F2F7;}
thead th{padding:5px 6px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;color:#6E6E73;white-space:nowrap;border-bottom:1px solid #E5E5EA;}
th.rl,td.rl{text-align:left;}
tbody td{padding:5px 6px;text-align:center;border-bottom:1px solid #F0F0F0;vertical-align:middle;}
td.calc{font-weight:700;}
tbody tr:nth-child(even){background:#FAFAFA;}
.two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;}
.sbox{background:#F9F9FB;border-radius:8px;padding:10px 13px;}
.sr{display:flex;justify-content:space-between;padding:3.5px 0;border-bottom:1px solid #E5E5EA;font-size:10px;}
.sr:last-child{border-bottom:none;}
.sl{color:#6E6E73;}.sv{font-weight:700;}
.pbox{background:#f0faf3;border:1px solid rgba(52,199,89,0.3);border-radius:8px;padding:9px 12px;margin-top:10px;}
.pbox h3{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#34C759;margin-bottom:6px;}
.pi{display:flex;gap:7px;padding:2.5px 0;font-size:9.5px;color:#3A3A3C;line-height:1.5;border-bottom:1px solid rgba(52,199,89,0.12);}
.pi:last-child{border-bottom:none;}.pn{font-weight:700;color:#34C759;flex-shrink:0;}
.fn{margin-top:10px;font-size:8px;color:#AEAEB2;text-align:center;line-height:1.8;border-top:1px solid #E5E5EA;padding-top:8px;}
.lgd{display:flex;gap:12px;margin-top:5px;flex-wrap:wrap;}
.li{display:flex;align-items:center;gap:4px;font-size:8px;color:#6E6E73;}
.ld{width:8px;height:8px;border-radius:50%;}
@media print{body{padding:8px 12px;}@page{margin:8mm;size:A4 landscape;}}
</style></head><body>
<div class="hdr">
  <div><h1>Low Dose Dobutamine Stress Echocardiogram</h1>
    <div class="sub">Aortic Stenosis — Low Flow Low Gradient Assessment · LDDSE Protocol</div></div>
  <div class="hdr-r">
    <div><strong>Date:</strong> ${fmtDate()}</div>
    ${reportingDoc?`<div><strong>Reporting:</strong> ${reportingDoc}</div>`:""}
    ${patientDOB?`<div><strong>DOB:</strong> ${patientDOB}</div>`:""}
  </div>
</div>
${patientName?`<div style="font-size:14px;font-weight:700;margin-bottom:10px;">${patientName}</div>`:""}
<div class="meta">
  <div class="mc"><label>LVOT Diameter</label><span>${lvotDiameter||"—"} cm</span></div>
  <div class="mc"><label>LVOT Area</label><span>${lvotDiameter?fmt(Math.PI*Math.pow(parseFloat(lvotDiameter)/2,2),3):"—"} cm²</span></div>
  <div class="mc"><label>BSA</label><span>${bsa?fmt(parseFloat(bsa),2):"—"} m²</span></div>
  <div class="mc"><label>Ht / Wt</label><span>${height&&weight?`${height}${hwUnits==="imperial"?" in":" cm"} / ${weight}${hwUnits==="imperial"?" lb":" kg"}${hwUnits==="imperial"?` (${fmt(p(height)*2.54,1)}cm / ${fmt(p(weight)*0.453592,1)}kg)`:""}`:"-"}</span></div>
  <div class="mc"><label>Stages</label><span>${filled.length} / ${STAGES.length}</span></div>
  <div class="mc"><label>Contractile Reserve</label>
    <span style="color:${crPresent===true?"#34C759":crPresent===false?"#FF3B30":"#8E8E93"}">${crPresent===null?"—":crPresent?"Present ≥20%":"Absent <20%"}</span></div>
</div>

<h2>Stage-by-Stage Measurements &amp; Derived Values</h2>
<table>
  <thead><tr>
    <th class="rl">Stage</th><th>HR</th><th>LVOT VTI</th><th>AV VTI</th>
    <th>AV Vmax (m/s)</th><th>Mean ΔP (mmHg)</th><th>LVET (ms)</th>
    <th>SV (mL)</th><th>SVI (mL/m²)</th><th>AVA (cm²)</th><th>Flow (mL/s)</th><th>Notes</th>
  </tr></thead>
  <tbody>${stageRows}</tbody>
</table>
<div class="lgd">
  <div class="li"><div class="ld" style="background:#FF3B30"></div>AVA &lt;1.0 severe / SVI &lt;35 / Flow &lt;200</div>
  <div class="li"><div class="ld" style="background:#FF9500"></div>AVA 1.0–1.5 moderate</div>
  <div class="li"><div class="ld" style="background:#34C759"></div>AVA &gt;1.0 normalised</div>
  <div class="li">★ Positive result &nbsp;·&nbsp; ⛔ Stopped</div>
</div>

<div class="two">
  <div>
    <h2 style="margin-top:10px;">Haemodynamic Summary</h2>
    <div class="sbox">
      <div class="sr"><span class="sl">Baseline SV</span><span class="sv">${fmt(baseSV,1)} mL</span></div>
      <div class="sr"><span class="sl">Peak SV</span><span class="sv">${fmt(peakSV,1)} mL</span></div>
      <div class="sr"><span class="sl">SV Augmentation</span><span class="sv">${svAug}</span></div>
      <div class="sr"><span class="sl">Baseline SVI</span><span class="sv" style="color:${results.baseline.svi&&results.baseline.svi<35?"#FF3B30":"inherit"}">${fmt(results.baseline.svi,1)} mL/m²${results.baseline.svi&&results.baseline.svi<35?" — Low Flow":""}</span></div>
      <div class="sr"><span class="sl">Baseline AVA</span><span class="sv">${fmt(results.baseline.ava,2)} cm²</span></div>
      <div class="sr"><span class="sl">Peak AVA</span><span class="sv" style="color:${peakAVAVal>1?"#34C759":peakAVAVal>0?"#FF3B30":"inherit"}">${peakAVAVal>0?fmt(peakAVAVal,2):"—"} cm²</span></div>
    </div>
    <div class="pbox">
      <h3>Positive Result Criteria</h3>
      <div class="pi"><span class="pn">1.</span><span><strong>AVA &gt;1.0 cm²</strong> at any flow → pseudo-severe AS</span></div>
      <div class="pi"><span class="pn">2.</span><span><strong>Vmax &gt;4 m/s or ΔP̄ &gt;40 mmHg</strong> with AVA &lt;1.0 cm² → true severe AS</span></div>
      <div class="pi"><span class="pn">3.</span><span><strong>Absent contractile reserve</strong> (SV &lt;20%): high surgical risk; AVR may still benefit LV</span></div>
    </div>
  </div>
  <div>${interpHTML}</div>
</div>

${avaProjIndicated && avaProj!==null ? `
<div style="margin-top:12px;border:1px solid ${avaProjClass==="true-severe"?"#FF3B30":avaProjClass==="moderate"?"#FF9500":"#34C759"};border-radius:8px;overflow:hidden;">
  <div style="background:${avaProjClass==="true-severe"?"rgba(255,59,48,0.06)":avaProjClass==="moderate"?"rgba(255,149,0,0.06)":"rgba(52,199,89,0.06)"};padding:10px 14px;border-bottom:1px solid #E5E5EA;">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:#0A84FF;margin-bottom:3px;">Projected AVA (AVAProj) — TOPAS Methodology</div>
    <div style="font-size:12px;font-weight:700;color:${avaProjClass==="true-severe"?"#FF3B30":avaProjClass==="moderate"?"#FF9500":"#34C759"};">
      AVAProj = ${fmt(avaProj,2)} cm²${avaProjIndexed?` &nbsp;·&nbsp; Indexed = ${fmt(avaProjIndexed,2)} cm²/m²`:""}
      &nbsp;→&nbsp; <span>${avaProjClass==="true-severe"?"True Severe AS":avaProjClass==="moderate"?"Moderate AS":"Not Severe"}</span>
    </div>
  </div>
  <div style="display:flex;gap:0;background:#E5E5EA;">
    <div style="flex:1;background:white;padding:8px 12px;border-right:1px solid #E5E5EA;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;color:#6E6E73;margin-bottom:2px;">Baseline AVA / Flow</div>
      <div style="font-size:11px;font-weight:700;">${fmt(results.baseline.ava,2)} cm² @ ${fmt(baseFlow,0)} mL/s</div>
    </div>
    <div style="flex:1;background:white;padding:8px 12px;border-right:1px solid #E5E5EA;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;color:#6E6E73;margin-bottom:2px;">Peak AVA / Flow</div>
      <div style="font-size:11px;font-weight:700;">${fmt(peakAVAVal>0?peakAVAVal:null,2)} cm² @ ${fmt(peakFlowForProj,0)} mL/s</div>
    </div>
    <div style="flex:1;background:white;padding:8px 12px;border-right:1px solid #E5E5EA;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;color:#6E6E73;margin-bottom:2px;">Flow Augmentation</div>
      <div style="font-size:11px;font-weight:700;">${fmt(flowAugPct,0)}% ${flowAugPct>=15?"✓":"✗"}</div>
    </div>
    <div style="flex:1;background:white;padding:8px 12px;">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;color:#6E6E73;margin-bottom:2px;">Reference Flow</div>
      <div style="font-size:11px;font-weight:700;">250 mL/s</div>
    </div>
  </div>
  <div style="padding:8px 12px;background:white;font-size:9px;color:#6E6E73;border-top:1px solid #E5E5EA;">
    AVAProj = AVArest + (AVApeak − AVArest) × (250 − FRrest) / (FRpeak − FRrest) &nbsp;·&nbsp; Peak values at stage of maximal mean gradient &nbsp;·&nbsp; Valid: flow aug ≥15%
  </div>
</div>` : avaProjIndicated===false && flowAugPct!==null && flowAugPct<15 ? `
<div style="margin-top:12px;border:1px solid #FF9500;border-radius:8px;padding:10px 14px;background:rgba(255,149,0,0.05);">
  <div style="font-size:10px;font-weight:700;color:#FF9500;margin-bottom:3px;">AVAProj Not Calculable — Flow Augmentation ${fmt(flowAugPct,0)}% &lt;15%</div>
  <div style="font-size:10px;color:#6E6E73;">CT aortic valve calcium scoring is the preferred alternative for severity adjudication.</div>
</div>` : ""}

<div class="fn">
  Protocol: 2.5→5→7.5→10→12.5→15→17.5→20 µg/kg/min · Additional stop: HR ≥100 · HR rise &gt;20 bpm · symptoms · BP drop · arrhythmia<br/>
  Low flow: SVI &lt;35 mL/m² or Flow &lt;200 mL/s · BSA Mosteller: √(H[cm]×W[kg]/3600) · AVA = SV÷AV VTI · Flow = SV÷LVET×1000<br/>
  <em>For clinical decision support only — must be interpreted in full clinical context by a qualified clinician.</em>
</div>
</body></html>`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles=`
  *{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg:#F2F2F7;--card:#FFFFFF;--card2:#F9F9FB;
    --border:rgba(60,60,67,0.13);--label:#6E6E73;--body:#1C1C1E;
    --blue:#007AFF;--bl:rgba(0,122,255,0.08);
    --r:16px;--rs:10px;
    --sh:0 1px 3px rgba(0,0,0,0.06),0 4px 16px rgba(0,0,0,0.05);
  }
  html,body{overflow-x:hidden;width:100%;}
  body{background:var(--bg);font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:var(--body);}
  .app{width:100%;max-width:860px;margin:0 auto;padding:20px 14px 80px;}

  /* Section */
  .sec{margin-bottom:20px;}
  .sec-title{font-size:11px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:var(--label);margin-bottom:9px;padding-left:2px;}

  /* Header */
  .app-hdr{margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;}
  .app-title{font-size:26px;font-weight:700;letter-spacing:-0.5px;}
  .app-sub{font-size:12px;color:var(--label);margin-top:3px;}

  /* Grid cell */
  .gc{background:var(--card);padding:12px 14px;display:flex;flex-direction:column;gap:4px;}
  .gc-label{font-size:11px;color:var(--label);font-weight:500;}
  .gc input[type=number]{border:none;outline:none;font-size:17px;font-weight:500;color:var(--body);background:transparent;width:100%;font-family:inherit;-moz-appearance:textfield;}
  .gc input[type=text]{border:none;outline:none;font-size:15px;font-weight:500;color:var(--body);background:transparent;width:100%;font-family:inherit;}
  .gc input::placeholder{color:#C7C7CC;font-weight:400;}
  .gc input::-webkit-outer-spin-button,.gc input::-webkit-inner-spin-button{-webkit-appearance:none;}
  .gc-unit{font-size:11px;color:#AEAEB2;}
  .gc.comp{background:var(--bl);}
  .gc.comp .val{font-size:17px;font-weight:600;color:var(--blue);}

  /* Grid card wrapper */
  .gcw{border-radius:var(--r);overflow:hidden;box-shadow:var(--sh);background:var(--border);display:grid;gap:1px;width:100%;}

  /* Two and three column grids — collapse to 2 cols on narrow */
  .g2{grid-template-columns:1fr 1fr;}
  .g3{grid-template-columns:1fr 1fr 1fr;}
  @media(max-width:520px){.g3{grid-template-columns:1fr 1fr;}}

  /* BSA toggle */
  .bsa-tog{display:flex;border-radius:20px;background:var(--card);box-shadow:var(--sh);overflow:hidden;width:fit-content;margin-bottom:10px;}
  .bsa-tog button{padding:6px 14px;border:none;background:transparent;font-size:12px;font-weight:500;color:var(--label);cursor:pointer;font-family:inherit;transition:all 0.15s;border-radius:20px;}
  .bsa-tog button.on{background:var(--blue);color:white;}

  /* Stage tabs — scrollable, no page overflow */
  .stage-tabs{display:flex;gap:5px;margin-bottom:12px;overflow-x:auto;padding-bottom:3px;-ms-overflow-style:none;scrollbar-width:none;width:100%;}
  .stage-tabs::-webkit-scrollbar{display:none;}
  .tab-btn{padding:7px 11px;border-radius:20px;border:none;background:var(--card);color:var(--label);font-size:11.5px;font-weight:500;cursor:pointer;white-space:nowrap;font-family:inherit;box-shadow:0 1px 3px rgba(0,0,0,0.08);flex-shrink:0;transition:background 0.15s,color 0.15s;}
  .tab-btn.on{background:var(--blue);color:white;box-shadow:0 2px 8px rgba(0,122,255,0.3);}
  .tab-btn.td:not(.on){background:rgba(0,122,255,0.08);color:var(--blue);}
  .tab-btn.ts:not(.on){background:rgba(255,59,48,0.08);color:#FF3B30;}
  .tab-btn.tp:not(.on){background:rgba(52,199,89,0.1);color:#34C759;}

  /* Stage card */
  .stage-card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh);overflow:hidden;width:100%;}
  .stage-hdr{padding:12px 14px;background:rgba(0,122,255,0.04);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;}

  /* Stage inputs — always 2 cols */
  .stage-inputs{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);}

  /* Results row — always 2 cols, stacks to fill */
  .res-row{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);border-top:1px solid var(--border);}
  .rc{background:var(--card2);padding:11px 14px;display:flex;flex-direction:column;gap:3px;}
  .rc-label{font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--label);font-weight:500;}
  .rc-val{font-size:20px;font-weight:600;letter-spacing:-0.3px;font-variant-numeric:tabular-nums;}
  .rc-unit{font-size:10px;color:#AEAEB2;}

  /* Badge */
  .badge{display:inline-flex;align-items:center;padding:2px 7px;border-radius:6px;font-size:10px;font-weight:600;width:fit-content;margin-top:2px;}

  /* Positive banner */
  .pos-banner{background:rgba(52,199,89,0.08);border-top:1px solid rgba(52,199,89,0.22);padding:10px 14px;display:flex;align-items:flex-start;gap:9px;}
  .pos-title{font-size:13px;font-weight:700;color:#34C759;margin-bottom:2px;}
  .pos-body{font-size:12px;color:#3A3A3C;line-height:1.5;}

  /* Stop bar — wrapping pills */
  .stop-bar{border-top:1px solid var(--border);padding:12px 14px;display:flex;align-items:flex-start;gap:6px;flex-wrap:wrap;}
  .stop-label{font-size:10px;font-weight:700;color:var(--label);text-transform:uppercase;letter-spacing:0.4px;flex-basis:100%;margin-bottom:4px;}
  .stop-btn{padding:5px 10px;border-radius:8px;border:1px solid var(--border);background:var(--card2);font-size:11px;font-weight:500;cursor:pointer;font-family:inherit;color:var(--label);transition:all 0.12s;white-space:nowrap;}
  .stop-btn:hover{background:rgba(255,59,48,0.06);border-color:rgba(255,59,48,0.3);color:#FF3B30;}
  .stop-btn.on{background:rgba(255,59,48,0.1);border-color:#FF3B30;color:#FF3B30;font-weight:600;}

  /* HR warning */
  .hr-warn{display:flex;align-items:center;gap:5px;font-size:12px;color:#FF9500;font-weight:500;}

  /* Overview table */
  .ov-table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed;}
  .ov-table thead tr{background:var(--card2);}
  .ov-table thead th{padding:7px 8px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;color:var(--label);text-align:center;border-bottom:1px solid var(--border);overflow:hidden;}
  .ov-table thead th:first-child{text-align:left;}
  .ov-table tbody td{padding:7px 8px;text-align:center;border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;}
  .ov-table tbody td:first-child{text-align:left;font-weight:600;font-size:11px;}
  .ov-table tbody tr:last-child td{border-bottom:none;}

  /* Summary card */
  .sum-card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh);padding:16px;}
  .sum-title{font-size:11px;font-weight:600;color:var(--label);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;}

  /* Stat tiles — always 3 across */
  .stat-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;}
  .stat{background:var(--card2);border-radius:var(--rs);padding:10px 12px;}
  .stat-label{font-size:10px;text-transform:uppercase;letter-spacing:0.4px;color:var(--label);font-weight:500;margin-bottom:3px;}
  .stat-val{font-size:16px;font-weight:700;letter-spacing:-0.2px;font-variant-numeric:tabular-nums;}
  .stat-unit{font-size:10px;color:#AEAEB2;margin-top:1px;}

  /* Charts — full width, stacked */
  .chart-card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh);padding:16px;}
  .chart-title{font-size:11px;font-weight:600;color:var(--label);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;}
  .mini-chart{display:flex;align-items:flex-end;gap:4px;height:70px;width:100%;}
  .bar-grp{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:100%;justify-content:flex-end;min-width:0;}
  .bar{width:100%;border-radius:3px 3px 0 0;min-height:3px;}
  .bar-lbl{font-size:8px;color:var(--label);text-align:center;overflow:hidden;width:100%;text-overflow:ellipsis;white-space:nowrap;}
  .bar-val{font-size:8px;font-weight:600;color:var(--body);font-variant-numeric:tabular-nums;}

  /* Interp card */
  .interp-card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh);padding:18px;}
  .interp-hdr{display:flex;align-items:center;gap:9px;margin-bottom:11px;}
  .interp-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
  .interp-title{font-size:15px;font-weight:600;}
  .interp-body{font-size:13px;line-height:1.65;color:var(--label);margin-bottom:13px;}
  .interp-crit{display:flex;align-items:flex-start;gap:8px;padding:6px 0;font-size:13px;color:var(--label);border-bottom:1px solid var(--border);}
  .interp-crit:last-child{border-bottom:none;}

  /* Positive def */

  /* Buttons */
  .btn-row{display:flex;gap:8px;flex-wrap:wrap;}
  .btn{display:flex;align-items:center;gap:6px;padding:9px 16px;border-radius:var(--rs);border:none;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;transition:opacity 0.15s;}
  .btn-p{background:var(--blue);color:white;box-shadow:0 2px 8px rgba(0,122,255,0.3);}
  .btn-p:hover{opacity:0.88;}
  .btn-g{background:var(--card);color:var(--label);box-shadow:var(--sh);border:1px solid var(--border);}
  .btn-g:hover{background:var(--bg);}

  .footnote{font-size:10px;color:#AEAEB2;text-align:center;line-height:1.7;margin-top:16px;}
`;

// ─── Small components ─────────────────────────────────────────────────────────
function NI({value,onChange,placeholder,step="0.1"}){
  return <input type="number" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} step={step} min="0"/>;
}
function Badge({color,text}){
  return <span className="badge" style={{background:color+"18",color}}>{text}</span>;
}
function Check({met}){
  if(met===true) return(<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0,marginTop:1}}>
    <circle cx="7" cy="7" r="7" fill="#34C75920"/><path d="M4 7l2 2 4-4" stroke="#34C759" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>);
  if(met===false) return(<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0,marginTop:1}}>
    <circle cx="7" cy="7" r="7" fill="#FF3B3020"/><path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="#FF3B30" strokeWidth="1.5" strokeLinecap="round"/></svg>);
  return(<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{flexShrink:0,marginTop:1}}>
    <circle cx="7" cy="7" r="7" fill="#8E8E9320"/><path d="M7 5v2.5" stroke="#8E8E93" strokeWidth="1.5" strokeLinecap="round"/><circle cx="7" cy="9.5" r="0.7" fill="#8E8E93"/></svg>);
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [patientName,setPatientName]=useState("");
  const [patientDOB,setPatientDOB]=useState("");
  const [reportingDoc,setReportingDoc]=useState("");
  const [lvotDiameter,setLvotDiameter]=useState("");
  const [bsaMode,setBsaMode]=useState("direct");
  const [bsaDirect,setBsaDirect]=useState("");
  const [height,setHeight]=useState("");
  const [weight,setWeight]=useState("");
  const [hwUnits,setHwUnits]=useState("metric"); // "metric" | "imperial"
  const [activeStage,setActiveStage]=useState("baseline");
  const [stageData,setStageData]=useState(initialStageData());

  // Convert to metric if imperial before Mosteller
  const heightCm = hwUnits==="imperial" && height ? (p(height)*2.54).toString() : height;
  const weightKg = hwUnits==="imperial" && weight ? (p(weight)*0.453592).toString() : weight;
  const bsaCalc=calcBSA(heightCm,weightKg);
  const bsa=bsaMode==="direct"?bsaDirect:(bsaCalc!==null?bsaCalc.toFixed(2):"");

  const updateStage=useCallback((sid,field,val)=>{
    setStageData(prev=>({...prev,[sid]:{...prev[sid],[field]:val}}));
  },[]);
  const toggleStop=useCallback((sid,reason)=>{
    setStageData(prev=>{
      const c=prev[sid],same=c.stopped&&c.stopReason===reason;
      return {...prev,[sid]:{...c,stopped:!same,stopReason:same?"":reason}};
    });
  },[]);
  const resetAll=async()=>{
    setPatientName("");setPatientDOB("");setReportingDoc("");
    setLvotDiameter("");setBsaDirect("");setHeight("");setWeight("");setHwUnits("metric");
    setStageData(initialStageData());setActiveStage("baseline");
    try { await window.storage.delete("lddse_session_v1"); } catch(e){}
  };

  // ── Persistent storage: save on every relevant state change ──────────────
  const STORAGE_KEY = "lddse_session_v1";

  // Save all form state to storage whenever anything changes
  useEffect(() => {
    const save = async () => {
      try {
        const state = {
          patientName, patientDOB, reportingDoc,
          lvotDiameter, bsaMode, bsaDirect,
          height, weight, hwUnits,
          activeStage, stageData,
          savedAt: Date.now(),
        };
        await window.storage.set(STORAGE_KEY, JSON.stringify(state));
      } catch(e) { /* storage unavailable — silent fail */ }
    };
    save();
  }, [patientName, patientDOB, reportingDoc, lvotDiameter, bsaMode, bsaDirect,
      height, weight, hwUnits, activeStage, stageData]);

  // Load saved state on first mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.storage.get(STORAGE_KEY);
        if (!result) return;
        const s = JSON.parse(result.value);
        // Only restore if saved within the last 8 hours
        if (Date.now() - (s.savedAt||0) > 8 * 60 * 60 * 1000) return;
        if (s.patientName   !== undefined) setPatientName(s.patientName);
        if (s.patientDOB    !== undefined) setPatientDOB(s.patientDOB);
        if (s.reportingDoc  !== undefined) setReportingDoc(s.reportingDoc);
        if (s.lvotDiameter  !== undefined) setLvotDiameter(s.lvotDiameter);
        if (s.bsaMode       !== undefined) setBsaMode(s.bsaMode);
        if (s.bsaDirect     !== undefined) setBsaDirect(s.bsaDirect);
        if (s.height        !== undefined) setHeight(s.height);
        if (s.weight        !== undefined) setWeight(s.weight);
        if (s.hwUnits       !== undefined) setHwUnits(s.hwUnits);
        if (s.activeStage   !== undefined) setActiveStage(s.activeStage);
        if (s.stageData     !== undefined) setStageData(s.stageData);
      } catch(e) { /* no saved state or parse error */ }
    };
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Compute all results
  const results={};
  for(const s of STAGES){
    const d=stageData[s.id];
    const sv=calcSV(lvotDiameter,d.lvotVTI);
    results[s.id]={sv,svi:calcSVI(sv,bsa),ava:calcAVA(sv,d.avVTI),flowRate:calcFlow(sv,d.lvEjectionTime)};
  }

  const allSVs=STAGES.map(s=>results[s.id].sv).filter(Boolean);
  const peakSV=allSVs.length?Math.max(...allSVs):null;
  const baseSV=results.baseline.sv;
  const crPresent=contractileReserve(baseSV,peakSV);
  const allAVAs=STAGES.map(s=>results[s.id].ava).filter(Boolean);
  const peakAVA=allAVAs.length?Math.max(...allAVAs):null;
  const baselineAVA=results.baseline.ava;
  const baseSVI=results.baseline.svi;
  const allFlows=STAGES.map(s=>results[s.id].flowRate).filter(Boolean);
  const peakFlow=allFlows.length?Math.max(...allFlows):null;
  const baseFlow=results.baseline.flowRate;
  const flowAugPct=baseFlow&&peakFlow?((peakFlow-baseFlow)/baseFlow)*100:null;

  // Projected AVA — use stage with maximal mean gradient as "peak stress" values
  // per TOPAS methodology. Fall back to stage with highest flow if no gradient data.
  const filledForProj = STAGES.filter(s => {
    const d2=stageData[s.id]; const r2=results[s.id];
    return r2.ava!==null && r2.flowRate!==null && d2.meanGradient!=="";
  });
  const peakGradStage = filledForProj.length
    ? filledForProj.reduce((best,s) => {
        const g=p(stageData[s.id].meanGradient);
        return g > p(stageData[best.id].meanGradient) ? s : best;
      }, filledForProj[0])
    : null;
  const peakAVAForProj  = peakGradStage ? results[peakGradStage.id].ava   : null;
  const peakFlowForProj = peakGradStage ? results[peakGradStage.id].flowRate : null;
  // Conditions to show projected AVA:
  // 1. Peak flow never reaches ≥200 mL/s
  // 2. Flow augmentation ≥ 15%
  // 3. Baseline AVA <1.0 (severe at rest)
  // 4. Mean gradient never crossed 40 mmHg (i.e. still inconclusive)
  const peakGrad = peakGradStage ? p(stageData[peakGradStage.id].meanGradient) : null;
  const flowNeverNormal = peakFlow!==null && peakFlow<200;
  const flowAugMet = flowAugPct!==null && flowAugPct>=15;
  const gradNeverCrossed = peakGrad===null || peakGrad<40;
  const avaProjIndicated = flowNeverNormal && flowAugMet && baselineAVA!==null && baselineAVA<1.0 && gradNeverCrossed;
  const avaProj = avaProjIndicated
    ? calcAVAProj(baselineAVA, peakAVAForProj, baseFlow, peakFlowForProj)
    : null;
  const avaProjIndexed = avaProj && bsa ? avaProj / p(bsa) : null;
  const avaProjClass = avaProj===null ? null : avaProj<=1.0 ? "true-severe" : avaProj<=1.5 ? "moderate" : "not-severe";

  function getInterp(){
    if(!baselineAVA||!baseSVI||baselineAVA>=1.0) return null;
    const pseudo=crPresent&&peakAVA!==null&&peakAVA>=1.0;
    const trueAS=crPresent&&peakAVA!==null&&peakAVA<1.0;
    const noRes=crPresent===false;
    if(pseudo) return{label:"Pseudo Severe AS",color:"#FF9500",
      text:"With dobutamine augmentation AVA normalises to ≥1.0 cm². Consistent with pseudo-severe aortic stenosis — low AVA at rest reflects reduced transvalvular flow rather than fixed obstruction.",
      criteria:[{met:true,text:"Resting AVA < 1.0 cm²"},{met:crPresent,text:"Contractile reserve present (≥20% SV increase)"},{met:peakAVA>=1.0,text:"Peak AVA ≥1.0 cm² with dobutamine — normalises (Criterion 1)"}]};
    if(trueAS) return{label:"True Severe AS",color:"#FF3B30",
      text:"AVA remains <1.0 cm² throughout dobutamine infusion despite adequate contractile reserve, confirming true severe AS with fixed obstruction independent of transvalvular flow.",
      criteria:[{met:true,text:"Resting AVA < 1.0 cm²"},{met:crPresent,text:"Contractile reserve present (≥20% SV increase)"},{met:peakAVA<1.0,text:"Peak AVA remains <1.0 cm² — fixed obstruction (Criterion 2)"}]};
    if(noRes) return{label:"No Contractile Reserve",color:"#8E8E93",
      text:"SV does not increase ≥20% with dobutamine. Absent contractile reserve is a predictor of high surgical mortality and poor long-term outcome. True vs pseudo severe AS cannot be reliably distinguished — however, AVR may still improve LV function and outcome in this subgroup. Consider CT aortic valve calcium scoring.",
      criteria:[{met:true,text:"Resting AVA < 1.0 cm²"},{met:false,text:"Contractile reserve absent — SV increase <20% (Criterion 3)"},{met:null,text:"AVA distinction inconclusive — consider AVC calcium scoring"}]};
    return null;
  }
  const interp=getInterp();

  // Active stage data
  const d=stageData[activeStage];
  const r=results[activeStage];
  const stageIdx=STAGES.findIndex(s=>s.id===activeStage);
  const baseHR=stageData.baseline.heartRate?p(stageData.baseline.heartRate):null;
  const hrVal=d.heartRate?p(d.heartRate):null;
  const hrWarn=hrVal!==null&&(hrVal>=100||(baseHR&&(hrVal-baseHR)>20));
  const activePos=detectPositive(r.ava,d.avPeakVelocity,d.meanGradient);

  // Chart
  const chartData=STAGES.map(s=>({label:s.shortLabel,sv:results[s.id].sv,ava:results[s.id].ava,flowRate:results[s.id].flowRate}));
  const maxSV=Math.max(...chartData.map(c=>c.sv||0),1);

  const handlePrint=()=>{
    const html=buildReportHTML({patientName,patientDOB,reportingDoc,lvotDiameter,bsa,height,weight,hwUnits,stageData,results,crPresent,baseSV,peakSV,interp,avaProj,avaProjIndexed,avaProjClass,avaProjIndicated,flowAugPct,baseFlow,peakFlowForProj,peakGradStage,stageData});
    openReportInTab(html);
  };

  const hasData=sid=>["lvotVTI","avVTI","avPeakVelocity","meanGradient","lvEjectionTime","heartRate"].some(f=>stageData[sid][f]!=="");

  return(<>
    <style>{styles}</style>
    <div className="app">

      {/* Header */}
      <div className="app-hdr">
        <div>
          <div className="app-title">LDDSE Protocol</div>
          <div className="app-sub">Low Dose Dobutamine Stress Echo · Aortic Stenosis Assessment</div>
        </div>
        <div className="btn-row">
          <button className="btn btn-p" onClick={handlePrint}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="5" width="10" height="7" rx="1.5" stroke="white" strokeWidth="1.3"/>
              <path d="M4 5V3a1 1 0 011-1h4a1 1 0 011 1v2" stroke="white" strokeWidth="1.3"/>
              <path d="M4 9.5h6M4 11.5h4" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Export / Print
          </button>
          <button className="btn btn-g" onClick={resetAll}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M6.5 1.5A5 5 0 1 0 11.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M9 1.5L11.5 1.5L11.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Reset
          </button>
        </div>
      </div>

      {/* Patient Info */}
      <div className="sec">
        <div className="sec-title">Patient Information</div>
        <div className="gcw g3">
          <div className="gc"><div className="gc-label">Patient Name</div>
            <input type="text" value={patientName} onChange={e=>setPatientName(e.target.value)} placeholder="Optional"/>
            <div className="gc-unit">identifier</div></div>
          <div className="gc"><div className="gc-label">Date of Birth</div>
            <input type="text" value={patientDOB} onChange={e=>setPatientDOB(e.target.value)} placeholder="DD/MM/YYYY"/>
            <div className="gc-unit">date</div></div>
          <div className="gc"><div className="gc-label">Reporting Clinician</div>
            <input type="text" value={reportingDoc} onChange={e=>setReportingDoc(e.target.value)} placeholder="Optional"/>
            <div className="gc-unit">name</div></div>
        </div>
      </div>

      {/* Cardiac Measurements */}
      <div className="sec">
        <div className="sec-title">Cardiac Measurements</div>
        <div className="gcw g3">
          <div className="gc"><div className="gc-label">LVOT Diameter</div>
            <NI value={lvotDiameter} onChange={setLvotDiameter} placeholder="2.0" step="0.01"/>
            <div className="gc-unit">cm</div></div>
          <div className="gc comp"><div className="gc-label">LVOT Area (auto)</div>
            <div className="val">{lvotDiameter?fmt(Math.PI*Math.pow(p(lvotDiameter)/2,2),3):"—"}</div>
            <div className="gc-unit">cm²</div></div>
          <div className="gc comp"><div className="gc-label">BSA</div>
            <div className="val">{bsa?fmt(p(bsa),2):"—"}</div>
            <div className="gc-unit">m²</div></div>
        </div>
      </div>

      {/* BSA */}
      <div className="sec">
        <div className="sec-title">Body Surface Area</div>
        <div className="bsa-tog">
          <button className={bsaMode==="direct"?"on":""} onClick={()=>setBsaMode("direct")}>Direct Entry</button>
          <button className={bsaMode==="calculated"?"on":""} onClick={()=>setBsaMode("calculated")}>Height &amp; Weight</button>
        </div>
        {bsaMode==="direct"?(
          <div className="gcw g2">
            <div className="gc"><div className="gc-label">BSA</div>
              <NI value={bsaDirect} onChange={setBsaDirect} placeholder="1.73" step="0.01"/>
              <div className="gc-unit">m²</div></div>
            <div className="gc" style={{background:"var(--card2)"}}>
              <div className="gc-label">Reference</div>
              <div style={{fontSize:12,color:"var(--label)",lineHeight:1.65}}>
                Average male ≈ 1.9 m²<br/>Average female ≈ 1.6 m²<br/>Or use Height &amp; Weight tab
              </div></div>
          </div>
        ):(
          <>
            <div className="bsa-tog" style={{marginBottom:10}}>
              <button className={hwUnits==="metric"?"on":""} onClick={()=>{setHwUnits("metric");setHeight("");setWeight("");}}>cm / kg</button>
              <button className={hwUnits==="imperial"?"on":""} onClick={()=>{setHwUnits("imperial");setHeight("");setWeight("");}}>in / lb</button>
            </div>
            <div className="gcw g3">
              <div className="gc">
                <div className="gc-label">Height</div>
                <NI value={height} onChange={setHeight}
                  placeholder={hwUnits==="metric"?"170":"67"} step={hwUnits==="metric"?"1":"0.5"}/>
                <div className="gc-unit">{hwUnits==="metric"?"cm":"inches"}</div>
              </div>
              <div className="gc">
                <div className="gc-label">Weight</div>
                <NI value={weight} onChange={setWeight}
                  placeholder={hwUnits==="metric"?"70":"154"} step={hwUnits==="metric"?"0.5":"1"}/>
                <div className="gc-unit">{hwUnits==="metric"?"kg":"lb"}</div>
              </div>
              <div className="gc comp">
                <div className="gc-label">BSA (Mosteller)</div>
                <div className="val">{bsaCalc!==null?fmt(bsaCalc,3):"—"}</div>
                <div className="gc-unit">
                  {hwUnits==="imperial"&&height&&weight
                    ? `${fmt(p(height)*2.54,1)} cm / ${fmt(p(weight)*0.453592,1)} kg → m²`
                    : "√(H[cm] × W[kg] / 3600)"}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Stage Tabs */}
      <div className="sec">
        <div className="sec-title">Dobutamine Stages</div>
        <div className="stage-tabs">
          {STAGES.map(s=>{
            const sd=stageData[s.id];
            const hd=hasData(s.id);
            const r2=results[s.id];
            const isPos=hd&&!!detectPositive(r2.ava,sd.avPeakVelocity,sd.meanGradient);
            return(
              <button key={s.id}
                className={`tab-btn ${activeStage===s.id?"on":""} ${sd.stopped?"ts":isPos?"tp":hd?"td":""}`}
                onClick={()=>setActiveStage(s.id)}>
                {sd.stopped?"⛔ ":isPos?"★ ":""}{s.label}
              </button>
            );
          })}
        </div>

        <div className="stage-card">
          {/* Stage header */}
          <div className="stage-hdr">
            <div>
              <span style={{fontWeight:700,fontSize:15}}>{STAGES.find(s=>s.id===activeStage).label.replace(" ✓","")}</span>
              {activeStage!=="baseline"&&<span style={{fontSize:12,color:"var(--label)",marginLeft:10}}>Stage {stageIdx} of {STAGES.length-1}</span>}
            </div>
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              {hrWarn&&(
                <div className="hr-warn">
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M6.5 2L12 11H1L6.5 2Z" stroke="#FF9500" strokeWidth="1.3" strokeLinejoin="round"/>
                    <path d="M6.5 6v2.5" stroke="#FF9500" strokeWidth="1.3" strokeLinecap="round"/>
                    <circle cx="6.5" cy="9.5" r="0.6" fill="#FF9500"/>
                  </svg>
                  HR threshold — consider stopping
                </div>
              )}
              {d.stopped&&<div style={{fontSize:12,color:"#FF3B30",fontWeight:600}}>⛔ {d.stopReason}</div>}
            </div>
          </div>

          {/* 2-col input grid */}
          <div className="stage-inputs">
            {[
              {field:"lvotVTI",       label:"LVOT VTI",         unit:"cm",   placeholder:"18.0"},
              {field:"avVTI",         label:"AV VTI",           unit:"cm",   placeholder:"80"},
              {field:"avPeakVelocity",label:"AV Peak Velocity",  unit:"m/s",  placeholder:"4.0"},
              {field:"meanGradient",  label:"Mean Gradient",    unit:"mmHg", placeholder:"35"},
              {field:"lvEjectionTime",label:"LV Ejection Time", unit:"ms",   placeholder:"300"},
              {field:"heartRate",     label:"Heart Rate",       unit:"bpm",  placeholder:"65"},
            ].map(({field,label,unit,placeholder})=>(
              <div className="gc" key={field} style={field==="heartRate"&&hrWarn?{background:"rgba(255,149,0,0.06)"}:{}}>
                <div className="gc-label">{label}</div>
                <NI value={d[field]} onChange={v=>updateStage(activeStage,field,v)} placeholder={placeholder}/>
                <div className="gc-unit">{unit}</div>
              </div>
            ))}
          </div>

          {/* 2×2 results */}
          <div className="res-row">
            <div className="rc">
              <div className="rc-label">Stroke Volume</div>
              <div className="rc-val">{fmt(r.sv,1)}</div>
              <div className="rc-unit">mL</div>
            </div>
            <div className="rc">
              <div className="rc-label">SV Index</div>
              <div className="rc-val" style={r.svi!==null&&r.svi<35?{color:C.severe}:{}}>{fmt(r.svi,1)}</div>
              <div className="rc-unit">mL/m²</div>
              {r.svi!==null&&<Badge color={r.svi<35?C.low:C.normal} text={r.svi<35?"Low Flow":"Normal"}/>}
            </div>
            <div className="rc">
              <div className="rc-label">AVA</div>
              <div className="rc-val" style={r.ava?{color:C[classifyAVA(r.ava)]}:{}}>{fmt(r.ava,2)}</div>
              <div className="rc-unit">cm²</div>
              {r.ava&&<Badge color={C[classifyAVA(r.ava)]} text={classifyAVA(r.ava)[0].toUpperCase()+classifyAVA(r.ava).slice(1)}/>}
            </div>
            <div className="rc">
              <div className="rc-label">Flow Rate</div>
              <div className="rc-val">{fmt(r.flowRate,0)}</div>
              <div className="rc-unit">mL/s</div>
              {r.flowRate!==null&&<Badge color={r.flowRate<200?C.low:C.normal} text={r.flowRate<200?"< 200":"≥ 200"}/>}
            </div>
          </div>

          {/* Positive banner */}
          {activePos&&(
            <div className="pos-banner">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{flexShrink:0,marginTop:1}}>
                <circle cx="8" cy="8" r="7.5" stroke="#34C759" strokeWidth="1.3"/>
                <path d="M5 8l2.5 2.5 4-4" stroke="#34C759" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div>
                <div className="pos-title">★ Positive Result Detected</div>
                <div className="pos-body">{activePos} — consider stopping infusion</div>
              </div>
            </div>
          )}

          {/* Stop criteria */}
          <div className="stop-bar">
            <span className="stop-label">Mark Infusion Stop Reason — Test Endpoints</span>
            {STOP_CRITERIA.map(sc=>(
              <button key={sc.id} className={`stop-btn ${d.stopped&&d.stopReason===sc.label?"on":""}`}
                onClick={()=>toggleStop(activeStage,sc.label)}>{sc.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Protocol Summary — full width, stacked */}
      <div className="sec">
        <div className="sec-title">Protocol Summary</div>

        {/* Haemodynamic Overview table */}
        <div className="sum-card" style={{marginBottom:14}}>
          <div className="sum-title">Haemodynamic Overview</div>
          <table className="ov-table">
            <thead>
              <tr>
                <th style={{textAlign:"left",width:"22%"}}>Stage</th>
                <th style={{width:"13%"}}>HR (bpm)</th>
                <th style={{width:"13%"}}>SV (mL)</th>
                <th style={{width:"14%"}}>SVI (mL/m²)</th>
                <th style={{width:"14%"}}>AVA (cm²)</th>
                <th style={{width:"14%"}}>Flow (mL/s)</th>
                <th style={{width:"10%"}}></th>
              </tr>
            </thead>
            <tbody>
              {STAGES.map(s=>{
                const rv=results[s.id];
                const sd=stageData[s.id];
                const hd=hasData(s.id);
                const isPos=hd&&!!detectPositive(rv.ava,sd.avPeakVelocity,sd.meanGradient);
                if(!hd) return null;
                return(
                  <tr key={s.id} style={s.id===activeStage?{background:"var(--bl)"}:{}}>
                    <td style={{fontSize:11,fontWeight:600}}>
                      <span style={{display:"inline-flex",alignItems:"center",gap:4}}>
                        {sd.stopped&&<span style={{color:"#FF3B30",fontSize:10}}>⛔</span>}
                        {isPos&&!sd.stopped&&<span style={{color:"#34C759",fontSize:10}}>★</span>}
                        {s.label.replace(" ✓","")}
                      </span>
                    </td>
                    <td style={{color:hrWarn&&s.id===activeStage?"#FF9500":"inherit"}}>{sd.heartRate||"—"}</td>
                    <td>{fmt(rv.sv,0)}</td>
                    <td style={{color:rv.svi&&rv.svi<35?C.severe:"inherit",fontWeight:rv.svi&&rv.svi<35?700:"normal"}}>
                      {fmt(rv.svi,1)}</td>
                    <td style={{color:rv.ava?rv.ava<1?C.severe:rv.ava>1?C.mild:"inherit":"inherit",fontWeight:700}}>
                      {fmt(rv.ava,2)}</td>
                    <td style={{color:rv.flowRate&&rv.flowRate<200?C.severe:"inherit",fontWeight:rv.flowRate&&rv.flowRate<200?700:"normal"}}>
                      {fmt(rv.flowRate,0)}</td>
                    <td>
                      {isPos&&<span style={{fontSize:10,color:"#34C759",fontWeight:700}}>★</span>}
                      {sd.stopped&&<span style={{fontSize:10,color:"#FF3B30",fontWeight:700,marginLeft:2}}>⛔</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Stat tiles below table */}
          <div className="stat-row">
            <div className="stat">
              <div className="stat-label">Contractile Reserve</div>
              <div className="stat-val" style={{fontSize:14,color:crPresent===null?"var(--label)":crPresent?C.normal:C.severe}}>
                {crPresent===null?"—":crPresent?"Present":"Absent"}
              </div>
              {crPresent!==null&&<div className="stat-unit">{crPresent?"≥20% SV increase":"<20% SV increase"}</div>}
            </div>
            <div className="stat">
              <div className="stat-label">SV Augmentation</div>
              <div className="stat-val">{baseSV&&peakSV?fmt(((peakSV-baseSV)/baseSV)*100,0)+"%":"—"}</div>
              {baseSV&&peakSV&&<div className="stat-unit">{fmt(baseSV,0)} → {fmt(peakSV,0)} mL</div>}
            </div>
            <div className="stat">
              <div className="stat-label">Flow Augmentation</div>
              <div className="stat-val">{flowAugPct!==null?fmt(flowAugPct,0)+"%":"—"}</div>
              {baseFlow&&peakFlow&&<div className="stat-unit">{fmt(baseFlow,0)} → {fmt(peakFlow,0)} mL/s</div>}
            </div>
            <div className="stat">
              <div className="stat-label">Baseline SVI</div>
              <div className="stat-val" style={{color:baseSVI&&baseSVI<35?C.severe:"var(--body)"}}>
                {fmt(baseSVI,1)}</div>
              <div className="stat-unit">mL/m²{baseSVI&&baseSVI<35?" — Low Flow":""}</div>
            </div>
          </div>
        </div>

        {/* Charts — full width, two stacked */}
        <div className="chart-card" style={{marginBottom:14}}>
          <div className="chart-title">Stroke Volume Trend</div>
          <div className="mini-chart">
            {chartData.map(c=>(
              <div className="bar-grp" key={c.label}>
                <div className="bar-val">{c.sv?fmt(c.sv,0):""}</div>
                <div className="bar" style={{height:c.sv?`${(c.sv/maxSV)*58}px`:"3px",
                  background:c.sv?"linear-gradient(180deg,#007AFF,rgba(0,122,255,0.4))":"var(--border)"}}/>
                <div className="bar-lbl">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="chart-title" style={{marginTop:18}}>AVA Trend</div>
          <div className="mini-chart">
            {chartData.map((c,i)=>{
              const ava=results[STAGES[i].id].ava;
              return(
                <div className="bar-grp" key={c.label}>
                  <div className="bar-val">{ava?fmt(ava,2):""}</div>
                  <div className="bar" style={{height:ava?`${(ava/2.5)*58}px`:"3px",
                    background:ava?ava<1?`linear-gradient(180deg,${C.severe},rgba(255,59,48,0.35))`:`linear-gradient(180deg,${C.mild},rgba(52,199,89,0.35))`:"var(--border)"}}/>
                  <div className="bar-lbl">{c.label}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:14,marginTop:8,flexWrap:"wrap"}}>
            {[["#FF3B30","< 1.0 severe"],["#FF9500","1.0–1.5 moderate"],["#34C759","> 1.0 normalised"]].map(([col,lbl])=>(
              <div key={lbl} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:10,height:10,borderRadius:2,background:col,flexShrink:0}}/>
                <span style={{fontSize:10,color:"var(--label)"}}>{lbl}</span>
              </div>
            ))}
          </div>

          <div className="chart-title" style={{marginTop:18}}>Flow Rate Trend</div>
          <div className="mini-chart">
            {chartData.map((c,i)=>{
              const fr=results[STAGES[i].id].flowRate;
              const maxFR=Math.max(...STAGES.map(s=>results[s.id].flowRate||0),1);
              return(
                <div className="bar-grp" key={c.label}>
                  <div className="bar-val">{fr?fmt(fr,0):""}</div>
                  <div className="bar" style={{height:fr?`${(fr/maxFR)*58}px`:"3px",
                    background:fr?fr<200?`linear-gradient(180deg,${C.severe},rgba(255,59,48,0.35))`:`linear-gradient(180deg,#5AC8FA,rgba(90,200,250,0.35))`:"var(--border)"}}/>
                  <div className="bar-lbl">{c.label}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:14,marginTop:8,flexWrap:"wrap"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:10,height:10,borderRadius:2,background:C.severe,flexShrink:0}}/>
              <span style={{fontSize:10,color:"var(--label)"}}>{"< 200 mL/s (low flow)"}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:10,height:10,borderRadius:2,background:"#5AC8FA",flexShrink:0}}/>
              <span style={{fontSize:10,color:"var(--label)"}}>{"≥ 200 mL/s"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Projected AVA Card — shown when indicated */}
      {(avaProjIndicated || (flowAugPct!==null && flowAugPct>=15 && baselineAVA!==null && baselineAVA<1.0)) && (
        <div className="sec">
          <div className="sec-title">Projected AVA (AVA<sub>Proj</sub>)</div>
          <div style={{background:"var(--card)",borderRadius:"var(--r)",boxShadow:"var(--sh)",overflow:"hidden"}}>

            {/* Header banner */}
            <div style={{padding:"14px 16px",background:"rgba(90,200,250,0.08)",borderBottom:"1px solid var(--border)"}}>
              <div style={{fontSize:13,fontWeight:700,color:"#0A84FF",marginBottom:4}}>
                Linear Extrapolation to 250 mL/s (TOPAS Methodology)
              </div>
              <div style={{fontSize:12,color:"var(--label)",lineHeight:1.6}}>
                Used when peak flow remains below 200 mL/s despite ≥15% flow augmentation — standardises AVA to a normal flow rate of 250 mL/s using linear extrapolation of the rest-to-peak AVA/flow rate relationship.
              </div>
            </div>

            {/* Prerequisite status */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"1px",background:"var(--border)"}}>
              <div className="gc">
                <div className="gc-label">Peak Flow Rate</div>
                <div style={{fontSize:17,fontWeight:600,color:peakFlow&&peakFlow<200?C.severe:C.normal}}>{fmt(peakFlow,0)}</div>
                <div className="gc-unit">mL/s {peakFlow&&peakFlow<200?"— never reached 200":""}</div>
              </div>
              <div className="gc">
                <div className="gc-label">Flow Augmentation</div>
                <div style={{fontSize:17,fontWeight:600,color:flowAugPct&&flowAugPct>=15?C.normal:C.severe}}>{fmt(flowAugPct,0)}%</div>
                <div className="gc-unit">{flowAugPct&&flowAugPct>=15?"✓ ≥15% — prerequisite met":"✗ <15% — prerequisite not met"}</div>
              </div>
              <div className="gc">
                <div className="gc-label">Baseline AVA</div>
                <div style={{fontSize:17,fontWeight:600,color:baselineAVA&&baselineAVA<1?C.severe:C.normal}}>{fmt(baselineAVA,2)}</div>
                <div className="gc-unit">cm² at rest</div>
              </div>
              <div className="gc">
                <div className="gc-label">Peak Mean Gradient</div>
                <div style={{fontSize:17,fontWeight:600,color:peakGrad&&peakGrad>=40?C.normal:C.warn}}>{peakGrad?fmt(peakGrad,0):"—"}</div>
                <div className="gc-unit">mmHg {peakGrad&&peakGrad<40?"— did not cross 40 mmHg":""}</div>
              </div>
            </div>

            {/* Result */}
            {avaProjIndicated && avaProj!==null ? (
              <div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"1px",background:"var(--border)"}}>
                  <div className="rc" style={{background: avaProjClass==="true-severe"?"rgba(255,59,48,0.06)": avaProjClass==="moderate"?"rgba(255,149,0,0.06)":"rgba(52,199,89,0.06)"}}>
                    <div className="rc-label">AVA<sub>Proj</sub></div>
                    <div className="rc-val" style={{color: avaProjClass==="true-severe"?C.severe: avaProjClass==="moderate"?C.moderate:C.mild}}>
                      {fmt(avaProj,2)}
                    </div>
                    <div className="rc-unit">cm²</div>
                    <span className="badge" style={{background:(avaProjClass==="true-severe"?C.severe:avaProjClass==="moderate"?C.moderate:C.mild)+"18",color:(avaProjClass==="true-severe"?C.severe:avaProjClass==="moderate"?C.moderate:C.mild)}}>
                      {avaProjClass==="true-severe"?"True Severe":avaProjClass==="moderate"?"Moderate AS":"Not Severe"}
                    </span>
                  </div>
                  <div className="rc" style={{background:"var(--card2)"}}>
                    <div className="rc-label">AVA<sub>Proj</sub> Indexed</div>
                    <div className="rc-val" style={{color:avaProjIndexed&&avaProjIndexed<=0.6?C.severe:C.mild}}>
                      {fmt(avaProjIndexed,2)}
                    </div>
                    <div className="rc-unit">cm²/m²</div>
                    {avaProjIndexed&&<span className="badge" style={{background:(avaProjIndexed<=0.6?C.severe:C.mild)+"18",color:avaProjIndexed<=0.6?C.severe:C.mild}}>{avaProjIndexed<=0.6?"≤0.6 Severe":">0.6"}</span>}
                  </div>
                  <div className="rc" style={{background:"var(--card2)"}}>
                    <div className="rc-label">Reference Flow</div>
                    <div className="rc-val" style={{color:"#0A84FF"}}>250</div>
                    <div className="rc-unit">mL/s (extrapolation target)</div>
                  </div>
                </div>

                {/* Interpretation callout */}
                <div style={{padding:"14px 16px",borderTop:"1px solid var(--border)",background: avaProjClass==="true-severe"?"rgba(255,59,48,0.04)": avaProjClass==="moderate"?"rgba(255,149,0,0.04)":"rgba(52,199,89,0.04)"}}>
                  <div style={{fontSize:13,fontWeight:700,color: avaProjClass==="true-severe"?C.severe: avaProjClass==="moderate"?C.moderate:C.mild,marginBottom:6}}>
                    {avaProjClass==="true-severe" && "AVAProj ≤ 1.0 cm² — Consistent with True Severe AS"}
                    {avaProjClass==="moderate"    && "AVAProj 1.0–1.5 cm² — Consistent with Moderate AS"}
                    {avaProjClass==="not-severe"  && "AVAProj > 1.5 cm² — Pseudo-Severe or Mild AS"}
                  </div>
                  <div style={{fontSize:12,color:"var(--label)",lineHeight:1.65}}>
                    {avaProjClass==="true-severe" && "Projected AVA ≤1.0 cm² (or indexed ≤0.6 cm²/m²) at a normalised flow of 250 mL/s confirms true-severe aortic stenosis. AVR is likely reasonable. This finding is consistent with fixed obstruction that would remain haemodynamically significant at normal flow."}
                    {avaProjClass==="moderate"    && "Projected AVA 1.0–1.5 cm² at normalised flow confirms the obstruction is in the moderate range. The severe appearance at rest was flow-dependent. Continued surveillance is appropriate; AVR is not indicated on severity grounds alone."}
                    {avaProjClass==="not-severe"  && "Projected AVA >1.5 cm² at normalised flow suggests the aortic stenosis is not truly severe. The low AVA and gradient at rest are likely explained by low transvalvular flow. AVR is not indicated on severity grounds alone."}
                  </div>
                  <div style={{marginTop:10,fontSize:11,color:"#AEAEB2",borderTop:"1px solid var(--border)",paddingTop:8}}>
                    Formula: AVA<sub>Proj</sub> = AVA<sub>rest</sub> + (AVA<sub>peak</sub> − AVA<sub>rest</sub>) × (250 − FR<sub>rest</sub>) / (FR<sub>peak</sub> − FR<sub>rest</sub>)<br/>
                    Peak stress values taken at stage of maximal mean gradient (TOPAS methodology). Valid only when flow augmentation ≥15%.
                  </div>
                </div>
              </div>
            ) : (
              <div style={{padding:"14px 16px",background:"rgba(255,149,0,0.05)",borderTop:"1px solid var(--border)"}}>
                <div style={{fontSize:13,fontWeight:600,color:C.moderate,marginBottom:4}}>
                  {flowAugPct!==null&&flowAugPct<15
                    ? "Flow augmentation < 15% — AVAProj cannot be reliably calculated"
                    : "Insufficient data to calculate AVAProj"}
                </div>
                <div style={{fontSize:12,color:"var(--label)",lineHeight:1.6}}>
                  {flowAugPct!==null&&flowAugPct<15
                    ? "A minimum 15% increase in flow rate from rest to peak stress is required for the projected AVA to be valid. CT aortic valve calcium scoring is the preferred alternative for severity adjudication when this threshold is not met."
                    : "Enter LVOT VTI, AV VTI, LV ejection time, and mean gradient at baseline and at least one stress stage to enable AVAProj calculation."}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Interpretation */}
      {interp&&(
        <div className="sec">
          <div className="sec-title">Clinical Interpretation</div>
          <div className="interp-card">
            <div className="interp-hdr">
              <div className="interp-dot" style={{background:interp.color}}/>
              <div className="interp-title" style={{color:interp.color}}>{interp.label}</div>
            </div>
            <div className="interp-body">{interp.text}</div>
            {interp.criteria.map((c,i)=>(
              <div className="interp-crit" key={i}><Check met={c.met}/><span>{c.text}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="footnote">
        Protocol: 2.5→5→7.5→10→12.5→15→17.5→20 µg/kg/min · Low flow: SVI &lt;35 mL/m² or Flow &lt;200 mL/s<br/>
        BSA: Mosteller √(H[cm]×W[kg]/3600) · AVA = SV÷AV VTI · Flow rate = SV÷LVET×1000<br/>
        <em>For clinical decision support only — interpret in full clinical context.</em>
      </div>
    </div>
  </>);
}
