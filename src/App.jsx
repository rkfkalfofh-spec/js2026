import React, { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

/**
 * Firebase 실사용 버전
 * - 참여코드 1개당 1응답
 * - 같은 코드 재접속 시 수정 가능
 * - 총점 동점 시 공동순위
 * - 관리자 이메일/비밀번호 로그인
 * - 관리자 페이지에서 코드 추가 / 투표 마감 / CSV 다운로드 / 투표 초기화
 * - Firestore 저장
 * - 이미 입력한 순위는 강조 표시 + 중복 입력 차단
 * - 제출 결과는 alert 팝업으로 안내
 */

const firebaseConfig = {
  apiKey: "여기에_API_KEY",
  authDomain: "여기에_AUTH_DOMAIN",
  projectId: "여기에_PROJECT_ID",
  storageBucket: "여기에_STORAGE_BUCKET",
  messagingSenderId: "여기에_MESSAGING_SENDER_ID",
  appId: "여기에_APP_ID",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const TASK_GROUPS = [
  { id: 1, items: ["문화예술교육(학생문예·예능 관련, 아르떼)"] },
  {
    id: 2,
    items: [
      "체육기구 및 체육관 관리",
      "체육실 관리",
      "체력건강교실",
      "학교 운동부 관리",
      "학생선수 관리",
      "팝스",
      "스포츠클럽",
      "체육교육(체육소위원회)",
      "방송부 조직 및 방송부원 지도",
    ],
  },
  { id: 3, items: ["학교생활기록부", "NEIS 운영", "정보공시"] },
  { id: 4, items: ["학교폭력(학교폭력전담기구, 어울림프로그램, 분리 지도)"] },
  { id: 5, items: ["기초학력(기초학력 보장 통합 사업 운영)"] },
  { id: 6, items: ["녹색학부모회", "교원연수(일반연수 및 전문적학습공동체, 직무연수)"] },
  { id: 7, items: ["학생자치회(학급·전교, 자치회 행사)", "꿈·끼 찾기 발표회(학생자치회 주관)"] },
  { id: 8, items: ["계기교육(평화통일, 독도, 경제교육 등)", "학생봉사활동"] },
  { id: 9, items: ["세계시민교육(민주시민교육, 국제교류)", "학생동아리"] },
  { id: 10, items: ["6학년 중입배정", "다문화 교육"] },
  { id: 11, items: ["6학년 졸업앨범", "영재·발명교육"] },
  { id: 12, items: ["특수교육", "개별화교육", "특수교육대상학생", "통합교육지원 등"] },
  {
    id: 13,
    items: [
      "영양교육 및 식생활지도",
      "아동급식(식단작성 및 영양관리, 식재료 선정 및 검수, 배식관리, 위생관리, 급식소위원회 관리 등)",
      "결식아동 및 무상우유 학생지원관리",
    ],
  },
  {
    id: 14,
    items: [
      "학교도서관 운영",
      "도서구입 및 관리",
      "독서교육 기획 및 지도(대내외 독서행사)",
      "도서도우미 운영",
      "문예행사지원(글쓰기)",
    ],
  },
  {
    id: 15,
    items: [
      "상담교육(Wee Class 운영)",
      "학부모상담",
      "또래중조",
      "학생정서·행동특성검사",
      "학교폭력업무지원(전담기구)",
      "생명존중교육(위기학생관리)",
      "사회정서교육",
    ],
  },
];

function makeEmptyRanks() {
  const obj = {};
  TASK_GROUPS.forEach((group) => {
    obj[group.id] = "";
  });
  return obj;
}

function validateRanks(ranks) {
  const values = Object.values(ranks);

  if (values.some((v) => v === "")) {
    return `모든 항목에 1~${TASK_GROUPS.length} 순위를 입력해야 합니다.`;
  }

  const nums = values.map((v) => Number(v));

  if (nums.some((n) => !Number.isInteger(n))) {
    return "순위는 숫자만 입력해야 합니다.";
  }

  if (nums.some((n) => n < 1 || n > TASK_GROUPS.length)) {
    return `순위는 1~${TASK_GROUPS.length} 범위만 입력할 수 있습니다.`;
  }

  const unique = new Set(nums);
  if (unique.size !== TASK_GROUPS.length) {
    return "같은 순위를 두 번 이상 입력할 수 없습니다.";
  }

  return null;
}

function calculateResults(ballots) {
  const acc = {};
  TASK_GROUPS.forEach((group) => {
    acc[group.id] = {
      id: group.id,
      scoreSum: 0,
      rankSum: 0,
      responseCount: 0,
    };
  });

  ballots.forEach((ballot) => {
    Object.entries(ballot.ranks || {}).forEach(([groupId, rank]) => {
      const id = Number(groupId);
      const r = Number(rank);
      const score = TASK_GROUPS.length + 1 - r;
      acc[id].scoreSum += score;
      acc[id].rankSum += r;
      acc[id].responseCount += 1;
    });
  });

  const resultList = Object.values(acc).map((item) => ({
    ...item,
    averageRank: item.responseCount > 0 ? Number((item.rankSum / item.responseCount).toFixed(2)) : 0,
  }));

  resultList.sort((a, b) => {
    if (b.scoreSum !== a.scoreSum) return b.scoreSum - a.scoreSum;
    return a.averageRank - b.averageRank;
  });

  let currentRank = 1;
  let tieCount = 1;

  return resultList.map((item, index) => {
    if (index === 0) return { ...item, finalRank: 1 };

    const prev = resultList[index - 1];
    if (item.scoreSum === prev.scoreSum) {
      tieCount += 1;
      return { ...item, finalRank: currentRank };
    }

    currentRank += tieCount;
    tieCount = 1;
    return { ...item, finalRank: currentRank };
  });
}

function downloadCSV(ballots) {
  const header = ["참여코드", "제출시각", ...TASK_GROUPS.map((g) => `업무${g.id}순위`)];

  const rows = ballots.map((ballot) => [
    ballot.code,
    ballot.updatedAtText || "",
    ...TASK_GROUPS.map((g) => ballot.ranks?.[g.id] ?? ""),
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll("\"", '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `업무난이도_원자료_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function cardStyle(emphasis = false) {
  return {
    border: "1px solid #cfcfcf",
    borderRadius: 10,
    background: emphasis ? "#fafafa" : "#ffffff",
    padding: 14,
    marginBottom: 12,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };
}

function buttonStyle(type = "default") {
  const map = {
    default: { background: "#111827", color: "#fff", border: "1px solid #111827" },
    light: { background: "#fff", color: "#111827", border: "1px solid #d1d5db" },
    danger: { background: "#b91c1c", color: "#fff", border: "1px solid #b91c1c" },
    success: { background: "#166534", color: "#fff", border: "1px solid #166534" },
  };

  return {
    ...map[type],
    borderRadius: 8,
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: 14,
    marginRight: 8,
  };
}

function inputStyle(width = 100) {
  return {
    width,
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid #cfcfcf",
    fontSize: 14,
  };
}

function formatDate(ts) {
  if (!ts) return "";
  const date = ts?.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ko-KR");
}

function getUsedRanks(ranks, currentId) {
  const used = new Set();
  Object.entries(ranks).forEach(([id, value]) => {
    if (Number(id) === Number(currentId)) return;
    if (value !== "") used.add(Number(value));
  });
  return used;
}

export default function App() {
  const [codeInput, setCodeInput] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const [ranks, setRanks] = useState(makeEmptyRanks());
  const [message, setMessage] = useState("");
  const [isClosed, setIsClosed] = useState(false);
  const [loadingParticipant, setLoadingParticipant] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resettingVotes, setResettingVotes] = useState(false);

  const [adminUser, setAdminUser] = useState(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminError, setAdminError] = useState("");
  const [codes, setCodes] = useState([]);
  const [ballots, setBallots] = useState([]);
  const [newCodeInput, setNewCodeInput] = useState("");

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setAdminUser(user || null);
    });

    const unsubSettings = onSnapshot(doc(db, "meta", "settings"), (snap) => {
      if (snap.exists()) {
        setIsClosed(Boolean(snap.data().isClosed));
      } else {
        setIsClosed(false);
      }
    });

    return () => {
      unsubAuth();
      unsubSettings();
    };
  }, []);

  useEffect(() => {
    if (!adminUser) {
      setCodes([]);
      setBallots([]);
      return;
    }

    const unsubCodes = onSnapshot(query(collection(db, "codes"), orderBy("createdAt", "asc")), (snap) => {
      setCodes(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }))
      );
    });

    const unsubBallots = onSnapshot(query(collection(db, "ballots"), orderBy("updatedAt", "desc")), (snap) => {
      setBallots(
        snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          updatedAtText: formatDate(d.data().updatedAt),
        }))
      );
    });

    return () => {
      unsubCodes();
      unsubBallots();
    };
  }, [adminUser]);

  const results = useMemo(() => calculateResults(ballots), [ballots]);

  const connectCode = async () => {
    try {
      setLoadingParticipant(true);
      const normalized = codeInput.trim().toUpperCase();

      if (!normalized) {
        setMessage("참여코드를 입력해야 합니다.");
        alert("참여코드를 입력해야 합니다.");
        return;
      }

      const codeRef = doc(db, "codes", normalized);
      const codeSnap = await getDoc(codeRef);

      if (!codeSnap.exists() || codeSnap.data().active !== true) {
        setMessage("유효하지 않은 참여코드입니다.");
        alert("유효하지 않은 참여코드입니다.");
        return;
      }

      setActiveCode(normalized);

      const ballotRef = doc(db, "ballots", normalized);
      const ballotSnap = await getDoc(ballotRef);

      if (ballotSnap.exists()) {
        const data = ballotSnap.data();
        setRanks(data.ranks || makeEmptyRanks());
        setMessage("기존 응답을 불러왔습니다. 수정 후 다시 제출하면 덮어쓰기됩니다.");
        alert("기존 응답을 불러왔습니다. 수정 후 다시 제출하면 덮어쓰기됩니다.");
      } else {
        setRanks(makeEmptyRanks());
        setMessage("새 응답을 입력할 수 있습니다.");
        alert("새 응답을 입력할 수 있습니다.");
      }
    } catch (error) {
      setMessage(`코드 확인 중 오류가 발생했습니다: ${error.message}`);
      alert(`코드 확인 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      setLoadingParticipant(false);
    }
  };

  const handleRankChange = (groupId, value) => {
    if (value === "") {
      setRanks((prev) => ({ ...prev, [groupId]: "" }));
      return;
    }

    if (!/^\d+$/.test(value)) return;

    const num = Number(value);
    if (num < 1 || num > TASK_GROUPS.length) return;

    const usedRanks = getUsedRanks(ranks, groupId);
    if (usedRanks.has(num)) {
      alert(`이미 ${num}위는 다른 항목에 입력되어 있습니다.`);
      return;
    }

    setRanks((prev) => ({ ...prev, [groupId]: value }));
  };

  const submitBallot = async () => {
    try {
      setSubmitting(true);

      if (isClosed) {
        setMessage("현재 투표가 마감되었습니다.");
        alert("현재 투표가 마감되었습니다.");
        return;
      }

      if (!activeCode) {
        setMessage("먼저 참여코드를 확인해야 합니다.");
        alert("먼저 참여코드를 확인해야 합니다.");
        return;
      }

      const error = validateRanks(ranks);
      if (error) {
        setMessage(error);
        alert(error);
        return;
      }

      await setDoc(
        doc(db, "ballots", activeCode),
        {
          code: activeCode,
          ranks: { ...ranks },
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setMessage("저장되었습니다. 같은 참여코드로 다시 접속하면 수정할 수 있습니다.");
      alert("저장 완료: 정상적으로 제출되었습니다. 같은 참여코드로 다시 접속하면 수정할 수 있습니다.");
    } catch (error) {
      setMessage(`저장 중 오류가 발생했습니다: ${error.message}`);
      alert(`저장 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const loginAdmin = async () => {
    try {
      setAdminError("");
      await signInWithEmailAndPassword(auth, adminEmail.trim(), adminPassword);
      setAdminPassword("");
    } catch (error) {
      setAdminError(`관리자 로그인 실패: ${error.message}`);
    }
  };

  const logoutAdmin = async () => {
    await signOut(auth);
  };

  const toggleClose = async () => {
    await setDoc(doc(db, "meta", "settings"), { isClosed: !isClosed }, { merge: true });
  };

  const addNewCode = async () => {
    const normalized = newCodeInput.trim().toUpperCase();
    if (!normalized) return;

    const codeRef = doc(db, "codes", normalized);
    const codeSnap = await getDoc(codeRef);
    if (codeSnap.exists()) {
      alert("이미 존재하는 참여코드입니다.");
      return;
    }

    await setDoc(codeRef, {
      active: true,
      createdAt: serverTimestamp(),
    });

    setNewCodeInput("");
  };

  const seedExampleCodes = async () => {
    const seedList = ["A7K9Q2", "M4P8LX", "T2W6NC", "R8V3ME", "K9D2PT"];
    for (const code of seedList) {
      await setDoc(
        doc(db, "codes", code),
        { active: true, createdAt: serverTimestamp() },
        { merge: true }
      );
    }
    alert("예시 참여코드를 추가했습니다.");
  };

  const resetAllVotes = async () => {
    const firstConfirm = window.confirm("정말 투표 기록을 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.");
    if (!firstConfirm) return;

    const secondConfirm = window.confirm("한 번 더 확인합니다. ballots 컬렉션의 모든 투표 기록이 삭제됩니다. 계속하시겠습니까?");
    if (!secondConfirm) return;

    try {
      setResettingVotes(true);
      const ballotSnap = await getDocs(collection(db, "ballots"));

      if (ballotSnap.empty) {
        alert("삭제할 투표 기록이 없습니다.");
        return;
      }

      let batch = writeBatch(db);
      let count = 0;

      for (const ballotDoc of ballotSnap.docs) {
        batch.delete(ballotDoc.ref);
        count += 1;

        if (count % 450 === 0) {
          await batch.commit();
          batch = writeBatch(db);
        }
      }

      if (count % 450 !== 0) {
        await batch.commit();
      }

      alert("투표 기록 초기화가 완료되었습니다.");
    } catch (error) {
      alert(`투표 기록 초기화 중 오류가 발생했습니다: ${error.message}`);
    } finally {
      setResettingVotes(false);
    }
  };

  if (adminUser) {
    return (
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24, fontFamily: "Arial, sans-serif", color: "#111827" }}>
        <h1 style={{ marginBottom: 8 }}>업무 난이도 투표 관리자 페이지</h1>
        <div style={{ color: "#4b5563", marginBottom: 20 }}>응답 집계, 원자료 다운로드, 참여코드 관리, 투표 마감 기능</div>

        <div style={cardStyle(true)}>
          <div style={{ marginBottom: 12, fontWeight: 700 }}>운영 상태</div>
          <div style={{ marginBottom: 10 }}>현재 상태: <strong>{isClosed ? "마감" : "진행 중"}</strong></div>
          <div style={{ marginBottom: 10 }}>총 응답 수: <strong>{ballots.length}</strong></div>
          <button style={buttonStyle(isClosed ? "success" : "danger")} onClick={toggleClose}>
            {isClosed ? "투표 재개" : "투표 마감"}
          </button>
          <button style={buttonStyle("light")} onClick={() => downloadCSV(ballots)}>원자료 CSV 다운로드</button>
          <button style={buttonStyle("danger")} onClick={resetAllVotes} disabled={resettingVotes}>
            {resettingVotes ? "초기화 중..." : "투표 초기화"}
          </button>
          <button style={buttonStyle("light")} onClick={logoutAdmin}>관리자 로그아웃</button>
        </div>

        <div style={cardStyle()}>
          <div style={{ marginBottom: 12, fontWeight: 700 }}>참여코드 관리</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <input
              style={inputStyle(180)}
              value={newCodeInput}
              onChange={(e) => setNewCodeInput(e.target.value.toUpperCase())}
              placeholder="새 참여코드 입력"
            />
            <button style={buttonStyle("default")} onClick={addNewCode}>코드 추가</button>
            <button style={buttonStyle("light")} onClick={seedExampleCodes}>예시 코드 5개 추가</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {codes.map((code) => {
              const responded = ballots.some((b) => b.code === code.id);
              return (
                <div key={code.id} style={{ border: "1px solid #d1d5db", borderRadius: 999, padding: "6px 10px", fontSize: 13 }}>
                  {code.id} {responded ? "· 응답 있음" : "· 미응답"}
                </div>
              );
            })}
          </div>
        </div>

        <div style={cardStyle()}>
          <div style={{ marginBottom: 12, fontWeight: 700 }}>최종 순위</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>순위</th>
                  <th style={thStyle}>업무 내용</th>
                  <th style={thStyle}>총점</th>
                  <th style={thStyle}>평균순위</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => {
                  const group = TASK_GROUPS.find((g) => g.id === result.id);
                  return (
                    <tr key={result.id}>
                      <td style={tdStyle}>{result.finalRank}</td>
                      <td style={tdStyle}>
                        {group.items.map((item) => (
                          <div key={item} style={{ marginBottom: 2 }}>{item}</div>
                        ))}
                      </td>
                      <td style={tdStyle}>{result.scoreSum}</td>
                      <td style={tdStyle}>{result.averageRank}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 10, color: "#4b5563", fontSize: 13 }}>
            동점 처리 기준: 총점이 같으면 공동순위로 처리하며, 다음 순위는 건너뜁니다.
          </div>
        </div>

        <div style={cardStyle()}>
          <div style={{ marginBottom: 12, fontWeight: 700 }}>익명 원자료 미리보기</div>
          <div style={{ overflowX: "auto", background: "#0f172a", color: "#f8fafc", borderRadius: 10, padding: 14, fontSize: 12 }}>
            <pre style={{ margin: 0 }}>{JSON.stringify(ballots, null, 2)}</pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24, fontFamily: "Arial, sans-serif", color: "#111827" }}>
      <h1 style={{ marginBottom: 8 }}>업무 난이도 순위 입력</h1>
      <div style={{ color: "#4b5563", marginBottom: 20 }}>
        참여코드 1개당 1건의 응답이 저장됩니다. 같은 참여코드로 다시 접속하면 기존 응답을 수정할 수 있습니다.
      </div>

      <div style={cardStyle(true)}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, marginBottom: 6 }}>참여코드</div>
            <input
              style={inputStyle(160)}
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="예: A7K9Q2"
            />
          </div>
          <div style={{ paddingTop: 20 }}>
            <button style={buttonStyle("default")} onClick={connectCode} disabled={loadingParticipant}>
              {loadingParticipant ? "확인 중..." : "코드 확인"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, color: isClosed ? "#b91c1c" : "#166534", fontWeight: 700 }}>
          현재 상태: {isClosed ? "투표 마감" : "투표 진행 중"}
        </div>
        {activeCode && (
          <div style={{ marginTop: 6, fontSize: 14 }}>
            현재 연결된 참여코드: <strong>{activeCode}</strong>
          </div>
        )}
        {message && (
          <div style={{ marginTop: 10, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, padding: 10, fontSize: 14 }}>
            {message}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 20 }}>
        <AdminLoginBox
          email={adminEmail}
          setEmail={setAdminEmail}
          password={adminPassword}
          setPassword={setAdminPassword}
          error={adminError}
          onLogin={loginAdmin}
        />
      </div>

      {TASK_GROUPS.map((group) => {
        const usedRanks = getUsedRanks(ranks, group.id);
        const currentValue = Number(ranks[group.id]);

        return (
          <div key={group.id} style={cardStyle()}>
            <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 16, alignItems: "start" }}>
              <div>
                <div style={{ fontSize: 13, marginBottom: 6, color: "#374151" }}>순위</div>
                <select
                  style={{
                    ...inputStyle(90),
                    background: ranks[group.id] ? "#ecfdf5" : "#ffffff",
                    border: ranks[group.id] ? "1px solid #10b981" : "1px solid #cfcfcf",
                  }}
                  value={ranks[group.id]}
                  onChange={(e) => handleRankChange(group.id, e.target.value)}
                >
                  <option value="">선택</option>
                  {Array.from({ length: TASK_GROUPS.length }, (_, idx) => idx + 1).map((num) => {
                    const disabled = usedRanks.has(num) && currentValue !== num;
                    return (
                      <option key={num} value={num} disabled={disabled}>
                        {disabled ? `${num}위 (사용중)` : `${num}위`}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>업무 내용</div>
                {group.items.map((item) => (
                  <div key={item} style={{ lineHeight: 1.7, paddingLeft: 2 }}>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      <button style={buttonStyle(isClosed ? "light" : "default")} onClick={submitBallot} disabled={isClosed || submitting}>
        {submitting ? "제출 중..." : "제출"}
      </button>
    </div>
  );
}

function AdminLoginBox({ email, setEmail, password, setPassword, error, onLogin }) {
  return (
    <div style={{ border: "1px dashed #d1d5db", borderRadius: 10, padding: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>관리자 로그인</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="관리자 이메일"
          style={inputStyle(220)}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="관리자 비밀번호"
          style={inputStyle(180)}
        />
        <button style={buttonStyle("light")} onClick={onLogin}>관리자 페이지 열기</button>
      </div>
      {error && <div style={{ color: "#b91c1c", marginTop: 8, fontSize: 13 }}>{error}</div>}
    </div>
  );
}

const thStyle = {
  border: "1px solid #d1d5db",
  background: "#f3f4f6",
  padding: 10,
  textAlign: "left",
  verticalAlign: "top",
};

const tdStyle = {
  border: "1px solid #d1d5db",
  padding: 10,
  textAlign: "left",
  verticalAlign: "top",
};
