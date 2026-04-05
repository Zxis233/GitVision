const PALETTE = [
  "#1677ff",
  "#d63384",
  "#2f9e44",
  "#e67700",
  "#7048e8",
  "#0c8599",
  "#c92a2a",
  "#5c940d",
  "#f08c00",
  "#1c7ed6",
  "#ae3ec9",
  "#099268",
];

function findLane(activeLanes, start = 0) {
  for (let index = start; index < activeLanes.length; index += 1) {
    if (activeLanes[index] == null) {
      return index;
    }
  }
  return activeLanes.length;
}

function trimTrailingGaps(activeLanes) {
  while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] == null) {
    activeLanes.pop();
  }
}

function normalizeRefName(value) {
  return String(value).trim().replaceAll("\\", "/");
}

function buildMainBranchCandidates(mainBranch) {
  const normalized = normalizeRefName(mainBranch);
  const candidates = new Set([normalized]);

  if (!normalized.startsWith("refs/")) {
    candidates.add(`refs/heads/${normalized}`);
    candidates.add(`refs/remotes/${normalized}`);

    if (!normalized.startsWith("origin/")) {
      candidates.add(`refs/remotes/origin/${normalized}`);
    }
  }

  return candidates;
}

function resolveMainBranch(repository, mainBranchName) {
  if (!mainBranchName) {
    return {
      ref: null,
      tipSha: "",
      mainlineShas: new Set(),
    };
  }

  const candidates = buildMainBranchCandidates(mainBranchName);
  const ref = (repository.refs ?? []).find(
    (candidate) => candidates.has(candidate.name) || candidates.has(candidate.fullName),
  );

  if (!ref) {
    throw new Error(`Main branch not found: ${mainBranchName}`);
  }

  const commitBySha = new Map(repository.commits.map((commit) => [commit.sha, commit]));
  const tipCommit = commitBySha.get(ref.sha);

  if (!tipCommit) {
    throw new Error(
      `Main branch '${mainBranchName}' is outside the current commit window. Increase --max-commits.`,
    );
  }

  const mainlineShas = new Set();
  let current = tipCommit;
  while (current && !mainlineShas.has(current.sha)) {
    mainlineShas.add(current.sha);
    current = commitBySha.get(current.parents[0]);
  }

  return {
    ref,
    tipSha: tipCommit.sha,
    mainlineShas,
  };
}

function findOccupiedLane(activeLanes, sha, laneZeroReserved, isMainline) {
  const occupiedLanes = [];
  for (let index = 0; index < activeLanes.length; index += 1) {
    if (activeLanes[index] === sha) {
      if (!laneZeroReserved || isMainline || index !== 0) {
        occupiedLanes.push(index);
      }
    }
  }
  return occupiedLanes;
}

function findAvailableLane(activeLanes, start, laneZeroReserved, isMainline) {
  const laneStart = laneZeroReserved && !isMainline ? Math.max(1, start) : start;
  return findLane(activeLanes, laneStart);
}

export function getLaneColor(index) {
  return PALETTE[index % PALETTE.length];
}

export function layoutGraph(repository, options = {}) {
  const mainBranch = resolveMainBranch(repository, options.mainBranch);
  const laneZeroReserved = Boolean(mainBranch.tipSha);
  const commits = repository.commits.map((commit, row) => ({
    ...commit,
    row,
    lane: 0,
  }));

  const activeLanes = [];
  if (laneZeroReserved) {
    activeLanes[0] = mainBranch.tipSha;
  }

  let maxLane = 0;

  for (const commit of commits) {
    const isMainline = mainBranch.mainlineShas.has(commit.sha);
    const occupiedLanes = findOccupiedLane(activeLanes, commit.sha, laneZeroReserved, isMainline);

    let lane = occupiedLanes[0];
    if (lane == null) {
      lane = findAvailableLane(activeLanes, 0, laneZeroReserved, isMainline);
    }

    if (isMainline) {
      lane = 0;
    }

    commit.lane = lane;
    maxLane = Math.max(maxLane, lane);

    for (const duplicateLane of occupiedLanes) {
      if (duplicateLane !== lane) {
        activeLanes[duplicateLane] = null;
      }
    }

    if (commit.parents.length > 0) {
      if (isMainline) {
        activeLanes[0] = commit.parents[0];
        if (lane !== 0) {
          activeLanes[lane] = null;
        }
      } else {
        activeLanes[lane] = commit.parents[0];
      }

      for (const parentSha of commit.parents.slice(1)) {
        const parentIsMainline = mainBranch.mainlineShas.has(parentSha);
        let parentLane = activeLanes.findIndex((candidate, candidateLane) => {
          if (candidate !== parentSha) {
            return false;
          }
          if (laneZeroReserved && !parentIsMainline && candidateLane === 0) {
            return false;
          }
          return true;
        });

        if (parentLane === -1) {
          parentLane = findAvailableLane(
            activeLanes,
            isMainline ? 1 : lane + 1,
            laneZeroReserved,
            parentIsMainline,
          );
        }

        if (parentLane === activeLanes.length) {
          activeLanes.push(parentSha);
        } else {
          activeLanes[parentLane] = parentSha;
        }

        maxLane = Math.max(maxLane, parentLane);
      }
    } else {
      if (isMainline) {
        activeLanes[0] = null;
        if (lane !== 0) {
          activeLanes[lane] = null;
        }
      } else {
        activeLanes[lane] = null;
      }
    }

    trimTrailingGaps(activeLanes);
  }

  const commitBySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const edges = [];

  for (const commit of commits) {
    commit.color = getLaneColor(commit.lane);

    for (const [index, parentSha] of commit.parents.entries()) {
      const parentCommit = commitBySha.get(parentSha);
      if (!parentCommit) {
        continue;
      }

      edges.push({
        from: commit.sha,
        to: parentSha,
        fromRow: commit.row,
        toRow: parentCommit.row,
        fromLane: commit.lane,
        toLane: parentCommit.lane,
        color: getLaneColor(index === 0 ? commit.lane : parentCommit.lane),
        isPrimary: index === 0,
      });
    }
  }

  return {
    ...repository,
    commits,
    edges,
    laneCount: Math.max(1, maxLane + 1),
    palette: PALETTE,
    mainBranch: mainBranch.ref?.name ?? "",
  };
}
