// Type definitions
import { execSync } from 'child_process';
interface Version {
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

type BranchType = 'feat' | 'fix' | 'main' | 'release' | 'other';

interface GitEnvironment {
  GITHUB_HEAD_REF?: string;
  GITHUB_REF_NAME?: string;
}

function getCurrentBranch(): string {
  const env = process.env as GitEnvironment;
  
  // In GitHub Actions, try to get the source branch from environment or commit message
  if (env.GITHUB_HEAD_REF) {
    // This is set for pull requests
    return env.GITHUB_HEAD_REF;
  }

  if (env.GITHUB_REF_NAME) {
    const currentBranch = env.GITHUB_REF_NAME;

    // If we're on main or release, try to detect source branch from recent commit
    if (currentBranch === "main" || currentBranch === "release") {
      try {
        // Get the most recent commit message
        const commitMessage = execSync('git log -1 --pretty=format:"%s"', { encoding: "utf8" }).trim();

        // Look for merge commit patterns
        const mergeMatch = commitMessage.match(/Merge pull request #\d+ from .+\/(feat|fix)\/(.+)/);
        if (mergeMatch) {
          return `${mergeMatch[1]}/branch-from-merge`;
        }

        // Look for commit message prefixes
        if (commitMessage.startsWith("feat:") || commitMessage.startsWith("feat(")) {
          return "feat/from-commit";
        }
        if (commitMessage.startsWith("fix:") || commitMessage.startsWith("fix(")) {
          return "fix/from-commit";
        }
      } catch {
        console.log("Could not detect source branch from commit message");
      }
    }

    return currentBranch;
  }

  // Fallback to git command (local usage)
  return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8" }).trim();
}

function parseVersion(tag: string): Version | null {
  const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/);
  if (!match) return null;

  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    beta: match[4] ? parseInt(match[4]) : null,
  };
}

function formatVersion(version: Version, isBeta: boolean = false): string {
  let versionStr = `v${version.major}.${version.minor}.${version.patch}`;
  if (isBeta && version.beta !== null) {
    versionStr += `-beta.${version.beta}`;
  }
  return versionStr;
}

function getAllTags(): string[] {
  try {
    const tags = execSync("git tag -l", { encoding: "utf8" }).trim();
    console.log("Tags", tags);
    return tags ? tags.split("\n") : [];
  } catch {
    return [];
  }
}

function getBranchType(branchName: string): BranchType {
  if (branchName.startsWith("feat/")) return "feat";
  if (branchName.startsWith("fix/")) return "fix";
  if (branchName === "main") return "main";
  if (branchName === "release") return "release";
  return "other";
}

function getNextVersion(currentBranch: string): string | null {
  const branchType = getBranchType(currentBranch);
  console.log(`Branch type: ${branchType}`);

  //if merged to release, release the new tag based on main's latest beta
  if (branchType === "release") {
    const latestTag = getLatestTag("main");
    const version = parseVersion(latestTag);
    if (version && version.beta !== null) {
      return formatVersion(version, false);
    }

    console.log("No beta version found, using latest tag");

    return latestTag;
  }

  //else if merged to main from another feat/fix branch, create a new beta tag based on the last stable version
  const baseVersion = getLatestTag("release");
  const latestBetaVersion = getLatestTag("main");
  
  const parsedBaseVersion = parseVersion(baseVersion);
  const parsedBetaVersion = parseVersion(latestBetaVersion);
  
  if (!parsedBaseVersion) {
    console.error("Could not parse base version");
    return null;
  }
  
  console.log("Base version for main:", formatVersion(parsedBaseVersion));
  console.log("Latest beta version:", parsedBetaVersion ? formatVersion(parsedBetaVersion, true) : "none");
  
  //if there's a beta version, increment it if it's the same base version, else start a new beta series
  if (
    parsedBetaVersion && (
      parsedBetaVersion.major !== parsedBaseVersion.major ||
      parsedBetaVersion.minor !== parsedBaseVersion.minor ||
      parsedBetaVersion.patch !== parsedBaseVersion.patch
    )
  ) {
    const newVersion: Version = {
      ...parsedBetaVersion,
      beta: (parsedBetaVersion.beta || 0) + 1,
    };

    return formatVersion(newVersion, true);
  } else {
    //if it's from a feat branch, increment minor, if fix branch increment patch
    if (branchType === "feat") {
      const newVersion: Version = {
        major: parsedBaseVersion.major,
        minor: parsedBaseVersion.minor + 1,
        patch: 0,
        beta: 0,
      };

      console.log('New version for feat:', formatVersion(newVersion, true));

      return formatVersion(newVersion, true);
    } else if (branchType === "fix") {
      const newVersion: Version = {
        major: parsedBaseVersion.major,
        minor: parsedBaseVersion.minor,
        patch: parsedBaseVersion.patch + 1,
        beta: 0,
      };

      console.log('New version for fix:', formatVersion(newVersion, true));

      return formatVersion(newVersion, true);
    }

    return null;
  }
}

function getLatestTag(branch: string): string {
  try {
    const latestTag = execSync(`git describe --tags --abbrev=0 origin/${branch}`, { encoding: "utf8" }).trim();
    console.log("Latest Tag", latestTag);

    return latestTag;
  } catch {
    return "v0.1.0"; // Default base tag
  }
}

function createTag(tagName: string): boolean {
  try {
    execSync(`git tag ${tagName}`, { stdio: "inherit" });
    console.log(`Created tag: ${tagName}`);

    // Push the tag to remote
    execSync(`git push origin ${tagName}`, { stdio: "inherit" });
    console.log(`Pushed tag: ${tagName}`);

    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to create/push tag: ${errorMessage}`);
    return false;
  }
}

function main(): void {
  const currentBranch = getCurrentBranch();
  const allTags = getAllTags();

  console.log(`Current branch: ${currentBranch}`);
  console.log(`Existing tags: ${allTags.join(", ") || "none"}`);

  const nextVersion = getNextVersion(currentBranch);

  if (!nextVersion) {
    console.log("No version update needed for this branch type");
    return;
  }

  if (allTags.includes(nextVersion)) {
    console.log(`Tag ${nextVersion} already exists, skipping`);
    return;
  }

  console.log(`Next version: ${nextVersion}`);

  const success = createTag(nextVersion);
  if (success) {
    console.log("Tagging completed successfully");
  } else {
    process.exit(1);
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main();
}

// Export functions for testing or external use
export {
  getCurrentBranch,
  getLatestTag,
  parseVersion,
  formatVersion,
  getBranchType,
  getNextVersion,
  createTag,
  main,
  type Version,
  type BranchType,
};