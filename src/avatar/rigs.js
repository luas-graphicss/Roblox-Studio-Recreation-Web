const SKIN = [0.953, 0.776, 0.565];
const TORSO = [0.039, 0.412, 0.675];
const LEG = [0.0, 0.643, 0.0];


const R6 = {
  rigType: "R6",
  modelName: "R6 Rig",
  rootPart: "HumanoidRootPart",
  parts: [
    { name: "HumanoidRootPart", size: [2, 2, 1], pos: [0, 3, 0], color: SKIN, transparency: 1 },
    { name: "Head", size: [2, 1, 1], pos: [0, 4.5, 0], color: SKIN, mesh: "Head" },
    { name: "Torso", size: [2, 2, 1], pos: [0, 3, 0], color: TORSO },
    { name: "Left Arm", size: [1, 2, 1], pos: [-1.5, 3, 0], color: SKIN },
    { name: "Right Arm", size: [1, 2, 1], pos: [1.5, 3, 0], color: SKIN },
    { name: "Left Leg", size: [1, 2, 1], pos: [-0.5, 1, 0], color: LEG },
    { name: "Right Leg", size: [1, 2, 1], pos: [0.5, 1, 0], color: LEG },
  ],
  joints: [
    { name: "RootJoint", part0: "HumanoidRootPart", part1: "Torso", parent: "HumanoidRootPart" },
    { name: "Neck", part0: "Torso", part1: "Head", parent: "Torso" },
    { name: "Left Shoulder", part0: "Torso", part1: "Left Arm", parent: "Torso" },
    { name: "Right Shoulder", part0: "Torso", part1: "Right Arm", parent: "Torso" },
    { name: "Left Hip", part0: "Torso", part1: "Left Leg", parent: "Torso" },
    { name: "Right Hip", part0: "Torso", part1: "Right Leg", parent: "Torso" },
  ],
};


const R15 = {
  rigType: "R15",
  modelName: "R15 Rig",
  rootPart: "HumanoidRootPart",
  parts: [
    { name: "HumanoidRootPart", size: [2, 2, 1], pos: [0, 3.15, 0], color: SKIN, transparency: 1 },
    { name: "LowerTorso", size: [2, 0.8, 1], pos: [0, 2.75, 0], color: TORSO },
    { name: "UpperTorso", size: [2, 1.2, 1], pos: [0, 3.75, 0], color: TORSO },
    { name: "Head", size: [1.6, 1.2, 1.4], pos: [0, 4.85, 0], color: SKIN, mesh: "Head" },
    { name: "LeftUpperArm", size: [0.9, 1.2, 0.9], pos: [-1.5, 3.75, 0], color: SKIN },
    { name: "LeftLowerArm", size: [0.9, 1.1, 0.9], pos: [-1.5, 2.65, 0], color: SKIN },
    { name: "LeftHand", size: [0.9, 0.5, 0.9], pos: [-1.5, 2.05, 0], color: SKIN },
    { name: "RightUpperArm", size: [0.9, 1.2, 0.9], pos: [1.5, 3.75, 0], color: SKIN },
    { name: "RightLowerArm", size: [0.9, 1.1, 0.9], pos: [1.5, 2.65, 0], color: SKIN },
    { name: "RightHand", size: [0.9, 0.5, 0.9], pos: [1.5, 2.05, 0], color: SKIN },
    { name: "LeftUpperLeg", size: [1, 1.2, 1], pos: [-0.5, 1.75, 0], color: LEG },
    { name: "LeftLowerLeg", size: [1, 1.2, 1], pos: [-0.5, 0.75, 0], color: LEG },
    { name: "LeftFoot", size: [1, 0.5, 1], pos: [-0.5, 0.25, 0], color: LEG },
    { name: "RightUpperLeg", size: [1, 1.2, 1], pos: [0.5, 1.75, 0], color: LEG },
    { name: "RightLowerLeg", size: [1, 1.2, 1], pos: [0.5, 0.75, 0], color: LEG },
    { name: "RightFoot", size: [1, 0.5, 1], pos: [0.5, 0.25, 0], color: LEG },
  ],
  joints: [
    { name: "Root", part0: "HumanoidRootPart", part1: "LowerTorso", parent: "LowerTorso" },
    { name: "Waist", part0: "LowerTorso", part1: "UpperTorso", parent: "UpperTorso" },
    { name: "Neck", part0: "UpperTorso", part1: "Head", parent: "Head" },
    { name: "LeftShoulder", part0: "UpperTorso", part1: "LeftUpperArm", parent: "LeftUpperArm" },
    { name: "LeftElbow", part0: "LeftUpperArm", part1: "LeftLowerArm", parent: "LeftLowerArm" },
    { name: "LeftWrist", part0: "LeftLowerArm", part1: "LeftHand", parent: "LeftHand" },
    { name: "RightShoulder", part0: "UpperTorso", part1: "RightUpperArm", parent: "RightUpperArm" },
    { name: "RightElbow", part0: "RightUpperArm", part1: "RightLowerArm", parent: "RightLowerArm" },
    { name: "RightWrist", part0: "RightLowerArm", part1: "RightHand", parent: "RightHand" },
    { name: "LeftHip", part0: "LowerTorso", part1: "LeftUpperLeg", parent: "LeftUpperLeg" },
    { name: "LeftKnee", part0: "LeftUpperLeg", part1: "LeftLowerLeg", parent: "LeftLowerLeg" },
    { name: "LeftAnkle", part0: "LeftLowerLeg", part1: "LeftFoot", parent: "LeftFoot" },
    { name: "RightHip", part0: "LowerTorso", part1: "RightUpperLeg", parent: "RightUpperLeg" },
    { name: "RightKnee", part0: "RightUpperLeg", part1: "RightLowerLeg", parent: "RightLowerLeg" },
    { name: "RightAnkle", part0: "RightLowerLeg", part1: "RightFoot", parent: "RightFoot" },
  ],
};


export const RIG_TEMPLATES = Object.freeze({ R6, R15 });

export function getRigTemplate(rigType) {
  return RIG_TEMPLATES[rigType] || null;
}
