/**
 * Müzakere Masası - CompDemocracy OpenData İçe Aktarma ve Test Tohumlama Scripti
 * compdemocracy/openData reposundan en çok katılıma sahip ilk 3 veri setini çeker:
 * 1. BG2050 (Bowling Green 2050 Vizyonu - 58 MB oy verisi)
 * 2. MARCHON (Operation Marching Orders - 14 MB oy verisi)
 * 3. KLIMA22 (Avusturya İklim Konseyi 2022 - 7 MB oy verisi)
 *
 * Gerçek oy matrisleriyle PCA + K-Means + Köprü analizi hesaplar ve veritabanına yükler.
 */

import { PrismaClient } from '@prisma/client';
import { calculatePCA, runKMeansWithStability, analyzeCampsAndBridges, calculatePolarisability } from './algorithms.js';
import { generateExecutiveSummary } from './services/llm.service.js';

const prisma = new PrismaClient();

const DATASETS = [
  {
    code: 'BG2050',
    title: 'Bowling Green 2050 Vizyonu (CompDemocracy)',
    description: 'Bowling Green 2050 Toplum Vizyonu ve Gönüllülük Katılım Oturumu (En Yüksek Katılımlı Açık Veri Seti #1 - 7.886 Katılımcı)',
    question: 'Bowling Green toplumunun 2050 vizyonunda öncelik verilmesi gereken ana alanlar ve kamu yatırımları neler olmalıdır?',
    commentsUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/bg2050-volunteers/comments.csv',
    votesUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/bg2050-volunteers/votes.csv'
  },
  {
    code: 'MARCHON',
    title: 'Operation Marching Orders (CompDemocracy)',
    description: 'Vatandaş İnisiyatifi & Siyasi Öncelikler Kamusal Müzakeresi (En Yüksek Katılımlı Açık Veri Seti #2 - 6.289 Katılımcı)',
    question: 'Adayların ve toplumun odaklanması gereken en temel toplumsal haklar ve siyasi öncelikler nelerdir?',
    commentsUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/march-on.operation-marchin-orders/comments.csv',
    votesUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/march-on.operation-marchin-orders/votes.csv'
  },
  {
    code: 'KLIMA22',
    title: 'Avusturya İklim Konseyi 2022 (CompDemocracy)',
    description: 'Klimaticket & 2040 İklim Nötr Eylem Planı Müzakeresi (En Yüksek Katılımlı Açık Veri Seti #3 - 3.142 Katılımcı)',
    question: 'Avusturya genelinde 2040 iklim nötrlük hedefine ulaşmak için ulaşım, sanayi ve enerji alanında hangi somut önlemler alınmalıdır?',
    commentsUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/austria-climate.5tzfrp5eaa.2022-07-07/comments.csv',
    votesUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/austria-climate.5tzfrp5eaa.2022-07-07/votes.csv'
  },
  {
    code: 'AMASSEM',
    title: 'American Assembly Kent Yönetimi (CompDemocracy)',
    description: 'Kent Yönetimi & Yerel Altyapı Müzakere Oturumu (En Yüksek Katılımlı Açık Veri Seti #4 - 2.031 Katılımcı)',
    question: 'Kent yönetimi, yerel altyapı ve kamu hizmetlerinin geliştirilmesinde toplumsal öncelikler neler olmalıdır?',
    commentsUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/american-assembly.bowling-green/comments.csv',
    votesUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/american-assembly.bowling-green/votes.csv'
  },
  {
    code: 'VTAIWAN',
    title: 'vTaiwan UberX Müzakeresi (CompDemocracy)',
    description: 'vTaiwan Dijital Paylaşım Ekonomisi & Sürücü Düzenlemesi Müzakeresi (En Yüksek Katılımlı Açık Veri Seti #5 - 1.921 Katılımcı)',
    question: 'UberX ve dijital yolcu taşıma hizmetlerinin düzenlenmesinde taksi esnafı, yolcular ve platformlar için adil kurallar nasıl olmalıdır?',
    commentsUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/vtaiwan.uberx/comments.csv',
    votesUrl: 'https://raw.githubusercontent.com/compdemocracy/openData/master/vtaiwan.uberx/votes.csv'
  }
];

// Gini Katsayısı Hesaplama
function calculateGini(values) {
  const n = values.length;
  if (n === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  if (sum === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let tempSum = 0;
  for (let i = 0; i < n; i++) tempSum += (i + 1) * sorted[i];
  return parseFloat(((2 * tempSum) / (n * sum) - (n + 1) / n).toFixed(3));
}

// Oy Tamamlama Oranı Hesaplama
function calcVoteCompletionRate(participants, statements) {
  const approvedIds = new Set(statements.map(st => st.id));
  let totalVotes = 0;
  participants.forEach(p => {
    Object.keys(p.votes).forEach(opId => {
      if (approvedIds.has(opId)) totalVotes++;
    });
  });
  const total = participants.length * statements.length;
  if (total === 0) return 0;
  return parseFloat(((totalVotes / total) * 100).toFixed(1));
}

async function seedOpenData() {
  console.log('🚀 CompDemocracy OpenData İçe Aktarım Süreci Başlatılıyor...\n');

  // Master admin kontrolü
  let admin = await prisma.admin.findFirst();
  if (!admin) {
    console.log('⚠️ Admin kullanıcısı bulunamadı, varsayılan admin ekleniyor...');
    admin = await prisma.admin.create({
      data: {
        email: 'admin@muzakere.local',
        username: 'admin',
        passwordHash: '$2b$12$e.zN2v7.e6j2h8R3.oW.u.k7eQ8r9'
      }
    });
  }

  for (const ds of DATASETS) {
    console.log(`\n======================================================`);
    console.log(`📦 [VERİ SETİ İŞLENİYOR] ${ds.code}: ${ds.title}`);
    console.log(`======================================================`);

    // 1. Görüşleri (Comments) İndir ve Ayrıştır
    console.log(`  -> Comments CSV indiriliyor...`);
    const cRes = await fetch(ds.commentsUrl);
    const cText = await cRes.text();
    const cLines = cText.split('\n').filter(l => l.trim().length > 0);

    const commentsMap = new Map();
    for (let i = 1; i < cLines.length; i++) {
      const line = cLines[i];
      // Format: timestamp,datetime,comment-id,author-id,agrees,disagrees,moderated,comment-body
      const parts = line.split(',');
      if (parts.length >= 8) {
        const commentId = parts[2]?.trim();
        const agrees = parseInt(parts[4] || '0', 10);
        const disagrees = parseInt(parts[5] || '0', 10);
        const moderated = parseInt(parts[6] || '0', 10);
        const text = parts.slice(7).join(',').replace(/^["']|["']$/g, '').trim();

        if (moderated === 1 && text && text.length > 5 && (agrees + disagrees) > 2) {
          commentsMap.set(commentId, {
            id: commentId,
            text,
            agrees,
            disagrees,
            totalVotes: agrees + disagrees,
            approvalRate: (agrees + disagrees) > 0 ? agrees / (agrees + disagrees) : 0
          });
        }
      }
    }

    console.log(`  -> Moderasyondan Geçen Onaylı Görüş Sayısı: ${commentsMap.size}`);

    // En çok oy alan ilk 25 kalite görüşü seçelim
    const sortedComments = Array.from(commentsMap.values())
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, 25);

    const selectedCommentIds = new Set(sortedComments.map(c => c.id));
    console.log(`  -> Analiz İçin Seçilen Görüş Sayısı: ${sortedComments.length}`);

    // 2. Oyları (Votes) İndir ve Katılımcı Matrisini Oluştur
    // Format: timestamp,datetime,comment-id,voter-id,vote
    console.log(`  -> Votes CSV indiriliyor...`);
    const vRes = await fetch(ds.votesUrl);
    const vText = await vRes.text();
    const vLines = vText.split('\n').filter(l => l.trim().length > 0);

    const voterVotesMap = new Map(); // voterId -> { [commentId]: voteValue }

    for (let i = 1; i < vLines.length; i++) {
      const line = vLines[i];
      const parts = line.split(',');
      if (parts.length >= 5) {
        const commentId = parts[2]?.trim();
        const voterId = parts[3]?.trim();
        const voteVal = parseInt(parts[4] || '0', 10);

        if (selectedCommentIds.has(commentId) && voterId) {
          if (!voterVotesMap.has(voterId)) {
            voterVotesMap.set(voterId, {});
          }
          voterVotesMap.get(voterId)[commentId] = voteVal;
        }
      }
    }

    // En az 3 oy vermiş olan aktif katılımcılardan ilk 500 tanesini alalım
    const participants = [];
    for (const [voterId, votes] of voterVotesMap.entries()) {
      if (Object.keys(votes).length >= 3) {
        participants.push({
          id: `p-${ds.code}-${voterId}`,
          nickname: `Katılımcı #${voterId}`,
          justification: `CompDemocracy OpenData (${ds.code}) katılımcısı`,
          votes
        });
      }
      if (participants.length >= 500) break;
    }

    console.log(`  -> Analiz İçin Yüklenen Aktif Katılımcı Sayısı: ${participants.length}`);

    // 3. Matris Analizini Çalıştır (PCA + K-Means + Köprüler)
    console.log(`  -> Algoritmik Analiz Motoru Çalıştırılıyor...`);

    const statements = sortedComments.map(c => ({
      id: c.id,
      text: c.text,
      author: 'Açık Veri Katılımcısı'
    }));

    const n = participants.length;

    // Katılımcı Oy Matrisi
    const X = participants.map(p => statements.map(st => p.votes[st.id] !== undefined ? p.votes[st.id] : null));

    // PCA Hesapla (2D)
    const pcaResult = calculatePCA(X, 2);
    const scores = pcaResult.scores;

    // Skorları 2D harita eksenlerine normalleştir (-80, +80)
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    scores.forEach(pt => {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    });
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;

    const coords = participants.map((p, i) => {
      let xCoord = 0;
      let yCoord = 0;
      if (rangeX > 1e-5) xCoord = ((scores[i][0] - minX) / rangeX) * 160 - 80;
      if (rangeY > 1e-5) yCoord = ((scores[i][1] - minY) / rangeY) * 160 - 80;
      return [xCoord, yCoord];
    });

    // K-Means Kümeleme (k=3)
    const k = 3;
    const kmResult = runKMeansWithStability(coords, k, 5);

    // Kutuplaşma Derecesi
    const points = coords.map((c, i) => ({ x: c[0], y: c[1], campId: kmResult.assignments[i] }));
    const camps = Array(k).fill(0).map((_, cIdx) => {
      const size = points.filter(pt => pt.campId === cIdx).length;
      const c = kmResult.centroids[cIdx] || [0, 0];
      return { id: cIdx, size, x: c[0], y: c[1] };
    });
    const polResult = calculatePolarisability(points, camps);

    // Köprü Cümleler ve Kamp Özellikleri
    const campAnalysis = analyzeCampsAndBridges(statements, participants, kmResult.assignments, k);

    // Gini ve Oy Tamamlama Oranı
    const votesPerParticipant = participants.map(p => Object.keys(p.votes).length);
    const participationGini = calculateGini(votesPerParticipant);
    const voteCompletionRate = calcVoteCompletionRate(participants, statements);

    // Kamp İsimleri
    const campNames = [
      'Toplumsal Dönüşüm & Yenilikçiler',
      'Dengeli / Merkezci Eğilim',
      'Korumacı & Yapısal Reformcular'
    ];

    // Analiz Nesnesini Oluştur
    const analysisResults = {
      campsCount: k,
      polarisability: polResult.polarisability,
      insufficientVariance: polResult.insufficientVariance,
      clusterStability: kmResult.clusterStability,
      participationGini,
      voteCompletionRate,
      points: participants.map((p, i) => ({
        id: p.id,
        nickname: p.nickname,
        x: parseFloat(coords[i][0].toFixed(2)),
        y: parseFloat(coords[i][1].toFixed(2)),
        campId: kmResult.assignments[i]
      })),
      camps: Array(k).fill(0).map((_, cIdx) => {
        const campSize = points.filter(pt => pt.campId === cIdx).length;
        const c = kmResult.centroids[cIdx] || [0, 0];
        const name = campNames[cIdx] || `Grup ${String.fromCharCode(65 + cIdx)}`;
        return {
          id: cIdx,
          name,
          size: campSize,
          x: parseFloat(c[0].toFixed(2)),
          y: parseFloat(c[1].toFixed(2)),
          topStatements: (campAnalysis.campCharacteristics[cIdx] || []).map(ch => ({
            id: ch.statement.id,
            text: ch.statement.text,
            approvalRate: Math.round(ch.approvalRate * 100),
            contrastScore: parseFloat((ch.contrastScore || 0).toFixed(2))
          })),
          summary: `${name}: ${campSize} katılımcının oy uyumuyla oluşan fikir kümesi.`
        };
      }),
      bridges: campAnalysis.bridges.map(b => ({
        id: b.statement.id,
        text: b.statement.text,
        overallRate: Math.round(b.overallRate * 100),
        minApproval: Math.round(b.minApproval * 100)
      }))
    };

    // Check if session already exists in DB (Requirement 6 - Idempotent Seed Import)
    const existingSession = await prisma.session.findUnique({ where: { code: ds.code } });
    if (existingSession) {
      console.log(`⚡ [SEED IDEMPOTENT] Oturum ${ds.code} zaten veritabanında mevcut. İçe aktarım atlanıyor.`);
      continue;
    }
    let executiveSummary = null;
      // LLM Yönetici Özeti Üret (Sadece ilk tohumlamada)
      console.log(`🌐 [SEED LLM CALL] Yeni oturum ${ds.code} için Yönetici Özeti oluşturuluyor...`);
      const execSummaryData = {
        question: ds.question,
        participantsCount: participants.length,
        statementsCount: statements.length,
        campsCount: k,
        camps: analysisResults.camps,
        polarisability: polResult.polarisability,
        bridgesCount: analysisResults.bridges.length,
        bridgesText: analysisResults.bridges.map(b => b.text),
        participationGini,
        voteCompletionRate
      };
      executiveSummary = await generateExecutiveSummary(execSummaryData, ds.code).catch(() => null);

    if (executiveSummary) {
      analysisResults.executiveSummary = executiveSummary;
    }

    // 4. Veritabanında Oturumu Oluştur / Upsert Et
    console.log(`  -> Oturum veritabanına kaydediliyor (${ds.code})...`);

    // Varolan eski kaydı temizle
    if (existingSession) {
      await prisma.session.delete({ where: { id: existingSession.id } }).catch(() => {});
    }

    // Yeni oturumu oluştur
    const createdSession = await prisma.session.create({
      data: {
        code: ds.code,
        title: ds.title,
        description: ds.description,
        question: ds.question,
        visibility: 'PUBLIC',
        status: 'COMPLETED',
        targetK: 3,
        creatorId: admin.id,
        analysis: analysisResults,
        opinions: {
          create: statements.map(st => ({
            text: st.text,
            author: st.author,
            status: 'APPROVED'
          }))
        }
      },
      include: {
        opinions: true
      }
    });

    // Katılımcıları ve Oyları Ekle
    const opinionIdMap = new Map();
    createdSession.opinions.forEach((op, idx) => {
      const origId = statements[idx].id;
      opinionIdMap.set(origId, op.id);
    });

    for (const p of participants) {
      const createdP = await prisma.participant.create({
        data: {
          sessionId: createdSession.id,
          nickname: p.nickname,
          justification: p.justification,
          isBot: false,
        }
      });

      const voteData = [];
      Object.entries(p.votes).forEach(([origOpId, val]) => {
        const prismaOpId = opinionIdMap.get(origOpId);
        if (prismaOpId && val !== undefined) {
          voteData.push({
            participantId: createdP.id,
            opinionId: prismaOpId,
            value: val
          });
        }
      });

      if (voteData.length > 0) {
        await prisma.vote.createMany({
          data: voteData
        });
      }
    }

    console.log(`✅ [BAŞARILI] ${ds.code} oturumu ${statements.length} görüş ve ${participants.length} aktif katılımcı ile veritabanına aktarıldı!`);
  }

  console.log('\n🎉 Tüm CompDemocracy OpenData test oturumları başarıyla içe aktarıldı!');
}

seedOpenData()
  .catch(e => {
    console.error('❌ İçe aktarma hatası:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
