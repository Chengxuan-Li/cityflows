// Height and slope are evaluated together. The slopes never differentiate a
// screen-space derivative, a filtered texture sample, or a divergent branch.
export const groundDetail = /* glsl */ `
const mat2 groundTurnA = mat2(0.8192,0.5736,-0.5736,0.8192);
const mat2 groundTurnB = mat2(0.6018,-0.7986,0.7986,0.6018);
const mat2 groundTurnC = mat2(0.3523,0.9359,-0.9359,0.3523);

struct GroundDomain {
  vec2 pos;
  mat2 warp;
  mat2 pixel;
};
struct GroundFinish {
  vec3 colour;
  vec3 relief; // height in metres, then its two horizontal derivatives
};

vec2 groundCorner(vec2 id) {
  float h=4.0*hashCell(id);
  float x=fract(h)*2.0-1.0;
  vec2 g=vec2(x,(1.0-abs(x))*(h<2.0 ? 1.0 : -1.0));
  return normalize(g);
}
vec3 groundGradientNoise(vec2 p) {
  vec2 id=floor(p), t=fract(p);
  vec2 a=groundCorner(id), b=groundCorner(id+vec2(1,0));
  vec2 c=groundCorner(id+vec2(0,1)), d=groundCorner(id+1.0);
  float na=dot(a,t), nb=dot(b,t-vec2(1,0)), nc=dot(c,t-vec2(0,1)), nd=dot(d,t-1.0);
  vec2 fade=t*t*t*(t*(t*6.0-15.0)+10.0);
  vec2 slope=30.0*t*t*(1.0-t)*(1.0-t);
  float lo=mix(na,nb,fade.x), hi=mix(nc,nd,fade.x);
  vec2 g=mix(mix(a,b,fade.x),mix(c,d,fade.x),fade.y)
    +slope*vec2(mix(nb-na,nd-nc,fade.y),hi-lo);
  return 1.12*vec3(mix(lo,hi,fade.y),g);
}
vec3 groundOctave(vec2 p,mat2 pixel,mat2 basis,vec2 seed) {
  mat2 footprint=basis*pixel;
  float px=max(length(footprint[0]),length(footprint[1]));
  if(px>=0.75) return vec3(0.0);
  vec3 n=groundGradientNoise(basis*p+seed);
  return vec3(n.x,transpose(basis)*n.yz)*(1.0-smoothstep(0.19,0.75,px));
}
GroundDomain groundDomain(vec2 p,mat2 pixel) {
  vec3 a=2.85*groundOctave(p,pixel,0.079*groundTurnB,vec2(17.1,-8.9));
  vec3 b=2.85*groundOctave(p,pixel,0.084*groundTurnC,vec2(-7.2,19.6));
  mat2 warp=mat2(1.0+a.y,b.y,a.z,1.0+b.z);
  return GroundDomain(p+vec2(a.x,b.x),warp,pixel);
}
vec3 groundGrain(GroundDomain g,float rate,mat2 turn,float seed) {
  vec3 n=groundOctave(g.pos,g.warp*g.pixel,rate*turn,vec2(seed,seed*0.713));
  return vec3(n.x,transpose(g.warp)*n.yz);
}
vec3 groundMask(vec3 n,float lo,float hi,mat2 pixel) {
  // Widen the transition by the projected width of the field across an output
  // pixel. Treat the width as a local filter, so its rate of change adds no relief.
  float edge=min(0.17,0.82*(abs(dot(n.yz,pixel[0]))+abs(dot(n.yz,pixel[1]))));
  float span=hi-lo+2.0*edge;
  float t=clamp((n.x-lo+edge)/span,0.0,1.0);
  return vec3(t*t*(3.0-2.0*t),n.yz*(6.0*t*(1.0-t)/span));
}
GroundFinish groundBlend(GroundFinish a,GroundFinish b,vec3 mask) {
  vec3 h=mix(a.relief,b.relief,mask.x);
  h.yz+=(b.relief.x-a.relief.x)*mask.yz;
  return GroundFinish(mix(a.colour,b.colour,mask.x),h);
}
GroundFinish disturbedGround(GroundDomain g) {
  vec3 wet=vec3(0.5,0,0)+groundGrain(g,0.19,groundTurnA,9.4)
    +0.31*groundGrain(g,0.71,groundTurnB,-13.3);
  vec3 moisture=groundMask(wet,0.43,0.69,g.pixel);
  vec3 gravel=groundGrain(g,1.54,groundTurnC,22.5);
  vec3 chips=groundGrain(g,7.2,groundTurnA,47.2);
  vec3 dust=groundGrain(g,15.0,groundTurnB,-34.6);
  vec3 colour=mix(vec3(0.78,0.74,0.65),vec3(0.56,0.50,0.40),moisture.x)
    *(0.92+0.065*gravel.x+0.26*chips.x+0.13*dust.x);
  vec3 height=0.066*gravel+0.018*chips+0.003*dust-0.100*moisture;
  return GroundFinish(colour,height);
}
GroundFinish turf(GroundDomain g) {
  vec3 growth=vec3(0.5,0,0)+0.82*groundGrain(g,0.16,groundTurnB,31.2)
    +0.48*groundGrain(g,0.64,groundTurnC,6.9);
  vec3 regrowth=vec3(0.5,0,0)+groundGrain(g,0.28,groundTurnA,3.4)
    +0.26*groundGrain(g,1.06,groundTurnB,-9.6);
  vec3 thatch=groundMask(regrowth,0.21,0.41,g.pixel);
  vec3 tufts=groundGrain(g,1.26,groundTurnB,44.8);
  vec3 blades=0.69*groundGrain(g,5.8,groundTurnC,-21.0)+0.31*groundGrain(g,8.7,groundTurnA,12.5);
  vec3 green=mix(vec3(0.43,0.59,0.30),vec3(0.78,0.88,0.60),growth.x);
  vec3 colour=mix(vec3(0.78,0.72,0.55),green,thatch.x)*(0.94+0.064*tufts.x+0.26*blades.x);
  vec3 height=vec3(0.036,0,0)+0.05*thatch+0.055*growth+0.120*tufts+0.011*blades;
  return GroundFinish(colour,height);
}
GroundFinish wildVerge(GroundDomain g,GroundFinish soil) {
  vec3 thickets=vec3(0.5,0,0)+groundGrain(g,0.52,groundTurnC,-5.8)
    +0.40*groundGrain(g,1.81,groundTurnA,56.5);
  GroundFinish green=turf(g);
  green.colour*=vec3(0.75,0.87,0.64);
  return groundBlend(soil,green,groundMask(thickets,0.26,0.53,g.pixel));
}
`;
