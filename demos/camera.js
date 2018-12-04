/**
 * @license
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
import * as posenet from '@tensorflow-models/posenet';
import p5 from 'p5';
import dat from 'dat.gui';
import Stats from 'stats.js';
import {drawBoundingBox, drawKeypoints, drawSkeleton} from './demo_util';

const videoWidth = 1200;
const videoHeight = 800;
const stats = new Stats();
var img;
var textArray = ("Always designing for people. Always designing for people Always designing for people Always designing for people Always designing for people Always designing for people Always designing for people").split('');
var ww;

let div = $("#myCanvas");
for (var i = 0; i < textArray.length; i++) {
  ww = document.createElement('span');
  ww.textContent = textArray[i];
  let id = 'txt' + i;
  ww.setAttribute('id', id);
  ww.setAttribute('class', 'font1');
  $("#textDiv").append(ww);
}

function isAndroid() {
  return /Android/i.test(navigator.userAgent);
}

function isiOS() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isMobile() {
  return isAndroid() || isiOS();
}

/**
 * Loads a the camera to be used in the demo
 *
 */
async function setupCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error(
        'Browser API navigator.mediaDevices.getUserMedia not available');
  }

  const video = document.getElementById('video');
  video.width = videoWidth;
  video.height = videoHeight;

  const mobile = isMobile();
  const stream = await navigator.mediaDevices.getUserMedia({
    'audio': false,
    'video': {
      facingMode: 'user',
      width: mobile ? undefined : videoWidth,
      height: mobile ? undefined : videoHeight,
    },
  });
  video.srcObject = stream;

  return new Promise((resolve) => {
    video.onloadedmetadata = () => {
      resolve(video);
    };
  });
}

async function loadVideo() {
  const video = await setupCamera();
  video.play();

  return video;
}

const guiState = {
  algorithm: 'single-pose',
  input: {
    mobileNetArchitecture: isMobile() ? '0.50' : '0.75',
    outputStride: 16,
    imageScaleFactor: 0.5,
  },
  singlePoseDetection: {
    minPoseConfidence: 0.1,
    minPartConfidence: 0.5,
  },
  multiPoseDetection: {
    maxPoseDetections: 5,
    minPoseConfidence: 0.15,
    minPartConfidence: 0.1,
    nmsRadius: 30.0,
  },
  output: {
    showVideo: true,
    showSkeleton: true,
    showPoints: true,
    showBoundingBox: false,
  },
  net: null,
};

/**
 * Sets up dat.gui controller on the top-right of the window
 */
function setupGui(cameras, net) {
  guiState.net = net;

  if (cameras.length > 0) {
    guiState.camera = cameras[0].deviceId;
  }

  const gui = new dat.GUI({width: 300});

  // The single-pose algorithm is faster and simpler but requires only one
  // person to be in the frame or results will be innaccurate. Multi-pose works
  // for more than 1 person
  const algorithmController =
      gui.add(guiState, 'algorithm', ['single-pose', 'multi-pose']);

  // The input parameters have the most effect on accuracy and speed of the
  // network
  let input = gui.addFolder('Input');
  // Architecture: there are a few PoseNet models varying in size and
  // accuracy. 1.01 is the largest, but will be the slowest. 0.50 is the
  // fastest, but least accurate.
  const architectureController = input.add(
      guiState.input, 'mobileNetArchitecture',
      ['1.01', '1.00', '0.75', '0.50']);
  // Output stride:  Internally, this parameter affects the height and width of
  // the layers in the neural network. The lower the value of the output stride
  // the higher the accuracy but slower the speed, the higher the value the
  // faster the speed but lower the accuracy.
  input.add(guiState.input, 'outputStride', [8, 16, 32]);
  // Image scale factor: What to scale the image by before feeding it through
  // the network.
  input.add(guiState.input, 'imageScaleFactor').min(0.2).max(1.0);
  input.open();

  // Pose confidence: the overall confidence in the estimation of a person's
  // pose (i.e. a person detected in a frame)
  // Min part confidence: the confidence that a particular estimated keypoint
  // position is accurate (i.e. the elbow's position)
  let single = gui.addFolder('Single Pose Detection');
  single.add(guiState.singlePoseDetection, 'minPoseConfidence', 0.0, 1.0);
  single.add(guiState.singlePoseDetection, 'minPartConfidence', 0.0, 1.0);

  let multi = gui.addFolder('Multi Pose Detection');
  multi.add(guiState.multiPoseDetection, 'maxPoseDetections')
      .min(1)
      .max(20)
      .step(1);
  multi.add(guiState.multiPoseDetection, 'minPoseConfidence', 0.0, 1.0);
  multi.add(guiState.multiPoseDetection, 'minPartConfidence', 0.0, 1.0);
  // nms Radius: controls the minimum distance between poses that are returned
  // defaults to 20, which is probably fine for most use cases
  multi.add(guiState.multiPoseDetection, 'nmsRadius').min(0.0).max(40.0);
  multi.open();

  let output = gui.addFolder('Output');
  output.add(guiState.output, 'showVideo');
  output.add(guiState.output, 'showSkeleton');
  output.add(guiState.output, 'showPoints');
  output.add(guiState.output, 'showBoundingBox');
  output.open();


  architectureController.onChange(function(architecture) {
    guiState.changeToArchitecture = architecture;
  });

  algorithmController.onChange(function(value) {
    switch (guiState.algorithm) {
      case 'single-pose':
        multi.close();
        single.open();
        break;
      case 'multi-pose':
        single.close();
        multi.open();
        break;
    }
  });
}

/**
 * Sets up a frames per second panel on the top-left of the window
 */
function setupFPS() {
  stats.showPanel(0);  // 0: fps, 1: ms, 2: mb, 3+: custom
  document.body.appendChild(stats.dom);
}

/**
 * Feeds an image to posenet to estimate poses - this is where the magic
 * happens. This function loops with a requestAnimationFrame method.
 */
var boop = true;
var font = 1;

function detectPoseInRealTime(video, net) {
  //const canvas = document.getElementById('output');
  //const ctx = canvas.getContext('2d');

  const canvas = document.getElementById('output2');
  const ctx = canvas.getContext('2d');
  // since images are being fed from a webcam
  const flipHorizontal = true;

  canvas.width = videoWidth;
  canvas.height = videoHeight;

  async function poseDetectionFrame() {
    if (guiState.changeToArchitecture) {
      // Important to purge variables and free up GPU memory
      guiState.net.dispose();

      // Load the PoseNet model weights for either the 0.50, 0.75, 1.00, or 1.01
      // version
      guiState.net = await posenet.load(+guiState.changeToArchitecture);

      guiState.changeToArchitecture = null;
    }

    // Begin monitoring code for frames per second
    stats.begin();

    // Scale an image down to a certain factor. Too large of an image will slow
    // down the GPU
    const imageScaleFactor = guiState.input.imageScaleFactor;
    const outputStride = +guiState.input.outputStride;

    let poses = [];
    let minPoseConfidence;
    let minPartConfidence;
    switch (guiState.algorithm) {
      case 'single-pose':
        const pose = await guiState.net.estimateSinglePose(
            video, imageScaleFactor, flipHorizontal, outputStride);
        poses.push(pose);

        minPoseConfidence = +guiState.singlePoseDetection.minPoseConfidence;
        minPartConfidence = +guiState.singlePoseDetection.minPartConfidence;
        break;
      case 'multi-pose':
        poses = await guiState.net.estimateMultiplePoses(
            video, imageScaleFactor, flipHorizontal, outputStride,
            guiState.multiPoseDetection.maxPoseDetections,
            guiState.multiPoseDetection.minPartConfidence,
            guiState.multiPoseDetection.nmsRadius);

        minPoseConfidence = +guiState.multiPoseDetection.minPoseConfidence;
        minPartConfidence = +guiState.multiPoseDetection.minPartConfidence;
        break;
    }

    ctx.clearRect(0, 0, videoWidth, videoHeight);
    guiState.output.showVideo = true;
    let vid = document.getElementById("video");
    vid.style.display = "block";
    //console.log(poses[0]);


    // if (guiState.output.showVideo) {
    //   ctx.save();
    //   ctx.scale(-1, 1);
    //   ctx.translate(-videoWidth, 0);
    //   ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
    //   ctx.restore();
    // }

    // For each pose (i.e. person) detected in an image, loop through the poses
    // and draw the resulting skeleton and keypoints if over certain confidence
    // scores
    poses.forEach(({score, keypoints}) => {
      if (score >= minPoseConfidence) {
        if (guiState.output.showPoints) {
          drawKeypoints(keypoints, minPartConfidence, ctx);
        }
        if (guiState.output.showSkeleton) {
          drawSkeleton(keypoints, minPartConfidence, ctx);
          //console.log(keypoints);
        }
        if (guiState.output.showBoundingBox) {
          drawBoundingBox(keypoints, ctx);
        }
      }
    });

    var ptList = {};
    var distances = {};
    var xCorner, yCorner, w, h;
    var letterDiv;
    var bodyParts = poses[0].keypoints;
    var leftElbow = bodyParts[7];
    var rightElbow = bodyParts[8];
    var leftWrist = bodyParts[9];
    var nose = bodyParts[0];
    var middleBody;
    var shuffle, c;

    // distance formula
    function diff (num1, num2) {
      if (num1 > num2) {
        return (num1 - num2);
      } else {
        return (num2 - num1);
      }
    };
    function dist (x1, y1, x2, y2) {
      var deltaX = diff(x1, x2);
      var deltaY = diff(y1, y2);
      var dist = Math.sqrt(Math.pow(deltaX, 2) + Math.pow(deltaY, 2));
      return (dist);
    };
    // map formula
    function map (num, in_min, in_max, out_min, out_max) {
      return (num - in_min) * (out_max - out_min) / (in_max - in_min) + out_min;
    }

    if (leftWrist != undefined && nose != undefined) {
      c = ww.class;
      shuffle = dist(nose.position['x'],nose.position['y'],leftWrist.position['x'],leftWrist.position['y']);
      // console.log(shuffle);

      if (shuffle == 60 && boop == true){
        boop = false;
      } else if (shuffle == 60 && boop == false){
        boop = true;
      }

      console.log(boop);

      // if (c == "font1") {
      //   console.log("switching to font2");
      //   ww.class = "font2";
      // } else {
      //   console.log("switching to font1");
      //   ww.class = "font1";
      // }
    }

    // finding center of each letter
    for(let i=0;i<textArray.length;i++) {
      letterDiv = $("#txt" + i);
      let boardDiv = $("#myCanvas");
      let c = document.getElementById("output2");
      let ctx2 = c.getContext("2d");
      xCorner = letterDiv.offset().left - boardDiv.offset().left;
      yCorner = letterDiv.offset().top - boardDiv.offset().top;
      w = letterDiv.width() / 2;
      h = letterDiv.height() / 2;
      ptList[i] = {'x':xCorner+w,'y':yCorner+h, 'index': i, 'letter': letterDiv.text()};
    }

    if (leftElbow != undefined && rightElbow != undefined) {
      let x = leftElbow.position['x'] + rightElbow.position['x'];
      let y = leftElbow.position['y'] + rightElbow.position['y'];

      middleBody = {position: {'x': x/2, 'y': y/2 }};

      let c = document.getElementById("output2");
      let ctx2 = c.getContext("2d");
      ctx2.beginPath();
      ctx2.arc(middleBody.position['x'],middleBody.position['y'], 5, 0, 2 * Math.PI);
      ctx2.fillStyle = '#A67DFC';
      ctx2.fill();
      ctx2.lineWidth = 1;
    }

    for (let l=0;l<textArray.length;l++)
    {
      let text = ptList[l].letter;
      let letter = ptList[l];
      let nose = bodyParts[0];
      let distance = dist(letter.x,letter.y,middleBody.position['x'],middleBody.position['y']);
      distances[l] = {'index':letter.index,'dist':distance, 'letter': text};
    }

    if (font == 1) {
      // attractor point
      for (let n=0;n<textArray.length;n++){
        let letterDiv = document.getElementById("txt" + n);
        let text = distances[n].letter;
        var impact = 781.0249;
        let hi = map(distances[n].dist,0,impact/2,500,-100);
        if (hi > 150){
          hi = 150;
        }

        if (hi < 0){
          hi = 0;
        }
        //console.log(hi);
        letterDiv.style.fontVariationSettings = " 'wght' " + hi;
      }
    }

    if (font == 2) {
      // attractor point
      for (let n=0;n<textArray.length;n++){
        let letterDiv = document.getElementById("txt" + n);
        let text = distances[n].letter;
        var impact = 781.0249;
        let hi = map(distances[n].dist,0,impact/2,0,500);
        // if (hi > 100){
        //   hi = 100;
        // }
        //
        // if (hi < 0){
        //   hi = 0;
        // }
        //console.log(hi);
        letterDiv.style.fontVariationSettings = " 'wght' " + hi + ", 'wdth' " + 0;
      }
    }

    // End monitoring code for frames per second
    stats.end();

    requestAnimationFrame(poseDetectionFrame);
  }

  poseDetectionFrame();
}

/**
 * Kicks off the demo by loading the posenet model, finding and loading
 * available camera devices, and setting off the detectPoseInRealTime function.
 */
export async function bindPage() {
  // Load the PoseNet model weights with architecture 0.75
  const net = await posenet.load(0.75);

  document.getElementById('loading').style.display = 'none';
  document.getElementById('main').style.display = 'block';

  let video;

  try {
    video = await loadVideo();
  } catch (e) {
    let info = document.getElementById('info');
    info.textContent = 'this browser does not support video capture,' +
        'or this device does not have a camera';
    info.style.display = 'block';
    throw e;
  }

  setupGui([], net);
  setupFPS();
  detectPoseInRealTime(video, net);
}

navigator.getUserMedia = navigator.getUserMedia ||
    navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
// kick off the demo
bindPage();
