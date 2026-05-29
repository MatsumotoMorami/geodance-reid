## 项目要求
我有若干个rtsp摄像头，场景是室内，其中可能若干个摄像头会有区域的重叠，所以可能对于一个人会有不同角度的多个人像出现在不同摄像头中。

我需要你基于现有的YOLO，ByteTrack / BoT-SORT，Re-ID库(如Fast-ReID等)，去搭建出一个系统。我的要求是一个基于Next.js的前后端全栈项目，前端展示所有的摄像头的实时界面，每个摄像头里会标不同的标号；通过Re-ID，在不同摄像头里的同一个人会获得同一个标号；最后得出目前总共有多少人的结论。

你的采样率可以比较低，比如图像处理可以三秒左右采集一次去处理这都没关系，但是摄像头是要实时渲染的，然后需要有一个框去框选整个人像，展示标号即可。

## 摄像头列表

rtsp://geo.7sref.com:1989/<device_name>

其中device_name有：

back_door
stairs_1
maimai
stairs_2
chuni
iidx
room
board_game
mahjong

其中stairs_1和stairs_2是低可用度摄像头，iidx是低清摄像头，这些你都要处理完善。